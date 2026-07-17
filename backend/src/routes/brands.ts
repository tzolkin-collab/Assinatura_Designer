import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { createError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';
import { mergeSlidesIntoPost } from '../lib/postHelper.js';
import { deleteFromR2 } from '../lib/r2.js';
import { requireBrandRole, ANY_MEMBER, type BrandRequest } from '../middleware/brandAccess.js';
import { getUsage, getBilling } from '../lib/aiBudget.js';

export const brandsRouter = Router();

// GET /api/brands/:slug/ai-usage - quanto de IA esta marca já gastou hoje, por modelo.
// Sem isto o teto é invisível: só se descobre que existe quando ele corta.
brandsRouter.get('/:slug/ai-usage', requireBrandRole(ANY_MEMBER), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const usage = await getUsage(req.brand!.slug);
    res.json({ data: usage });
  } catch (error) {
    next(error);
  }
});

// GET /api/brands/:slug/ai-usage/billing?month=YYYY-MM - gasto do mês quebrado por modelo.
// O diário some em 3 dias; isto lê o rollup mensal (retenção longa) que sustenta a fatura.
brandsRouter.get('/:slug/ai-usage/billing', requireBrandRole(ANY_MEMBER), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    const billing = await getBilling(req.brand!.slug, month);
    res.json({ data: billing });
  } catch (error) {
    next(error);
  }
});

// GET /api/brands - List the authenticated user's brands
brandsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const brands = await prisma.brand.findMany({
      where: { members: { some: { userId } } },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { posts: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } }
      },
    });
    const mapped = brands.map(b => ({
      ...b,
      myRole: b.members.find(m => m.userId === userId)?.role,
      user: b.members.find(m => m.role === 'OWNER')?.user
    }));
    res.json({ data: mapped });
  } catch (error) {
    next(error);
  }
});

// GET /api/brands/discover - List all brands the user is NOT a member of
brandsRouter.get('/discover', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const brands = await prisma.brand.findMany({
      where: { NOT: { members: { some: { userId } } } },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { posts: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        accessRequests: { where: { userId, status: 'PENDING' } }
      },
    });
    const mapped = brands.map(b => ({
      ...b,
      user: b.members.find(m => m.role === 'OWNER')?.user,
      pendingRequest: b.accessRequests.length > 0
    }));
    res.json({ data: mapped });
  } catch (error) {
    next(error);
  }
});

// GET /api/brands/:slug - Get single brand (must belong to user)
brandsRouter.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const brand = await prisma.brand.findFirst({
      where: { slug, members: { some: { userId } } },
      include: { 
        config: true, 
        _count: { select: { posts: true, refs: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } }
      },
    });
    if (!brand) throw createError(404, 'Brand not found');
    
    // Inject current user role
    const myMembership = brand.members.find(m => m.userId === userId);
    res.json({ data: { ...brand, myRole: myMembership?.role } });
  } catch (error) {
    next(error);
  }
});

// GET /api/brands/:slug/posts - Get all posts for a brand (must belong to user)
brandsRouter.get('/:slug/posts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const brand = await prisma.brand.findFirst({
      where: { slug, members: { some: { userId } } },
      select: { id: true },
    });
    if (!brand) throw createError(404, 'Brand not found');
    const posts = await prisma.post.findMany({
      where: { brandId: brand.id },
      orderBy: { createdAt: 'desc' },
      include: { 
        folder: true, 
        slides: { orderBy: { position: 'asc' } },
        createdBy: { select: { id: true, name: true, email: true } }
      },
    });
    res.json({ data: posts.map(mergeSlidesIntoPost) });
  } catch (error) {
    next(error);
  }
});

// POST /api/brands - Create a new brand (userId from JWT)
brandsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const { name, color } = req.body;
    if (!name) throw createError(400, 'Name is required');

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const exist = await prisma.brand.findUnique({ where: { slug } });
    if (exist) throw createError(409, 'Brand with this name already exists');

    const brand = await prisma.brand.create({
      data: { 
        name, 
        slug, 
        color: color || '#171717',
        members: {
          create: { user: { connect: { id: userId } }, role: 'OWNER' }
        }
      },
    });
    res.status(201).json({ data: brand });
  } catch (error) {
    next(error);
  }
});

// PUT /api/brands/:slug - Update brand (must belong to user)
brandsRouter.put('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const { name, color } = req.body;
    const existing = await prisma.brand.findFirst({ where: { slug, members: { some: { userId, role: { in: ['OWNER', 'ADMIN'] } } } } });
    if (!existing) throw createError(404, 'Brand not found');
    const brand = await prisma.brand.update({ where: { slug }, data: { name, color } });
    res.json({ data: brand });
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 'P2025') {
      return next(createError(404, 'Brand not found'));
    }
    
    return next(error);
  }
});

// GET /api/brands/:slug/logo-asset — proxy logo server-side to avoid CORS
brandsRouter.get('/:slug/logo-asset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const brand = await prisma.brand.findFirst({
      where: { slug, members: { some: { userId } } },
      include: { config: true },
    });
    if (!brand) throw createError(404, 'Brand not found');
    const logoUrl = brand.config?.logoUrl;
    if (!logoUrl) throw createError(404, 'No logo configured for this brand');
    const imgRes = await fetch(logoUrl);
    if (!imgRes.ok) throw createError(502, 'Failed to fetch logo from storage');
    const contentType = imgRes.headers.get('content-type') || 'image/png';
    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    res.json({
      data: {
        name: 'logo',
        mimeType: contentType,
        dataBase64: base64,
        sizeBytes: buffer.byteLength,
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/brands/:slug - Delete brand (must belong to user)
brandsRouter.delete('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const existing = await prisma.brand.findFirst({ where: { slug, members: { some: { userId, role: 'OWNER' } } } });
    if (!existing) throw createError(404, 'Brand not found');

    const assets = await prisma.asset.findMany({
      where: { brandId: existing.id },
      select: { url: true }
    });

    await prisma.brand.delete({ where: { slug } });

    if (assets.length > 0) {
      Promise.allSettled(assets.map(asset => deleteFromR2(asset.url))).catch(console.error);
    }

    res.json({ message: 'Brand deleted successfully' });
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 'P2025') {
      return next(createError(404, 'Brand not found'));
    }
    
    return next(error);
  }
});

// POST /api/brands/:slug/request-access - Request access to a brand
brandsRouter.post('/:slug/request-access', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    
    const brand = await prisma.brand.findUnique({
      where: { slug },
      include: { members: { where: { role: 'OWNER' } } }
    });
    
    if (!brand) throw createError(404, 'Brand not found');
    
    const isMember = await prisma.brandMember.findUnique({
      where: { userId_brandId: { userId, brandId: brand.id } }
    });
    
    if (isMember) throw createError(400, 'You are already a member');
    
    const existingReq = await prisma.accessRequest.findUnique({
      where: { userId_brandId: { userId, brandId: brand.id } }
    });
    
    if (existingReq && existingReq.status === 'PENDING') {
      throw createError(400, 'Request already pending');
    }
    
    let request;
    if (existingReq) {
      request = await prisma.accessRequest.update({
        where: { id: existingReq.id },
        data: { status: 'PENDING', updatedAt: new Date() }
      });
    } else {
      request = await prisma.accessRequest.create({
        data: { userId, brandId: brand.id, status: 'PENDING' }
      });
    }
    
    // Notify Owner
    const owner = brand.members[0];
    if (owner) {
      const requester = await prisma.user.findUnique({ where: { id: userId } });
      await prisma.notification.create({
        data: {
          userId: owner.userId,
          title: 'Solicitação de Acesso',
          message: `${requester?.name || 'Um usuário'} solicitou acesso ao projeto ${brand.name}.`,
          type: 'INFO',
          link: `/${brand.slug}/configuracoes/equipe`
        }
      });
    }
    
    res.json({ data: request });
  } catch (error) {
    next(error);
  }
});

// POST /api/brands/:slug/requests/:requestId/approve - Approve access request
brandsRouter.post('/:slug/requests/:requestId/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const requestId = req.params.requestId as string;
    const { role = 'VIEWER' } = req.body;
    
    const brand = await prisma.brand.findFirst({
      where: { slug, members: { some: { userId, role: { in: ['OWNER', 'ADMIN'] } } } }
    });
    
    if (!brand) throw createError(403, 'Not authorized');
    
    const request = await prisma.accessRequest.findUnique({ where: { id: requestId } });
    if (!request || request.brandId !== brand.id) throw createError(404, 'Request not found');
    
    await prisma.accessRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED' }
    });
    
    const member = await prisma.brandMember.upsert({
      where: { userId_brandId: { userId: request.userId, brandId: brand.id } },
      create: { userId: request.userId, brandId: brand.id, role },
      update: { role }
    });
    
    // Notify requester
    await prisma.notification.create({
      data: {
        userId: request.userId,
        title: 'Acesso Aprovado',
        message: `Seu acesso ao projeto ${brand.name} foi aprovado!`,
        type: 'SUCCESS',
        link: `/${brand.slug}/galeria`
      }
    });
    
    res.json({ data: member });
  } catch (error) {
    next(error);
  }
});
