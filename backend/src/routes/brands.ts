import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { ensureInternalTeamMemberships } from '../lib/internalTeam.js';
import { createError } from '../middleware/errorHandler.js';
import { normalizarLogoParaFundoEscuro } from '../lib/logoTransparency.js';
import type { AuthRequest } from '../middleware/auth.js';
import { mergeSlidesIntoPost } from '../lib/postHelper.js';
import { deleteFromR2 } from '../lib/r2.js';
import { requireBrandRole, ANY_MEMBER, EDITORS, type BrandRequest } from '../middleware/brandAccess.js';
import { getUsage, getBilling } from '../lib/aiBudget.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { parseBody } from '../lib/validate.js';
import { createCollabSchema, collabSlug } from '../lib/brandCollab.js';
import type { Prisma } from '@prisma/client';
import { SVG_SANITIZE_RATE_LIMIT } from '../lib/svgSanitizeRateLimit.js';

import multer from 'multer';
import { processBrandbookIngest } from '../lib/brandbookIngestion.js';
import { getValidAccessToken, exportDesign, waitForExport } from '../lib/canvaClient.js';

export const brandsRouter = Router();
const brandbookUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// POST /api/brands/:slug/brandbook/ingest - Upload e processamento do Brandbook
// Requer papel EDITOR+ para evitar que um usuário autenticado processe o brandbook de outra marca
//
// Rate limit ANTES do multer/requireBrandRole: um upload de brandbook aceita até 15
// arquivos numa ÚNICA requisição (não são 15 chamadas HTTP — não gasta orçamento extra
// do rate limit), mas a rota chama sanitizeSvg em cada um deles. Ver
// lib/svgSanitizeRateLimit.ts para a justificativa dos números e por que o orçamento é
// COMPARTILHADO com as outras rotas que também sanitizam SVG (assets.ts, upload.ts).
brandsRouter.post('/:slug/brandbook/ingest', rateLimit(SVG_SANITIZE_RATE_LIMIT), requireBrandRole(EDITORS), brandbookUpload.array('files', 15), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.user!;
    const slug = req.brand!.slug;
    const files = (req.files as Express.Multer.File[]) || [];

    if (files.length === 0) {
      throw createError(400, 'Nenhum arquivo enviado para o Brandbook');
    }

    const result = await processBrandbookIngest({
      brandSlug: slug,
      files,
      uploadedByUserId: userId,
    });

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/brands/:slug/brandbook/ingest-canva - Importar e analisar Brandbook direto do Canva
// Requer papel EDITOR+ para evitar que um usuário autenticado processe o brandbook de outra marca
brandsRouter.post('/:slug/brandbook/ingest-canva', requireBrandRole(EDITORS), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const { userId } = req.user!;
    const slug = req.brand!.slug;
    let { designId, designUrl } = req.body;

    if (!designId && designUrl) {
      const match = String(designUrl).match(/design\/([A-Za-z0-9_-]+)/);
      if (match) designId = match[1];
    }

    if (!designId) {
      throw createError(400, 'É necessário informar o designId ou a URL do design do Canva');
    }

    const token = await getValidAccessToken(userId);
    if (!token) {
      throw createError(400, 'Sua conta do Canva não está conectada. Conecte sua conta em Configurações > Integrações.');
    }

    // Exporta o design do Canva como imagens PNG para análise
    const exportJob = (await exportDesign(userId, designId, 'png')) as { job?: { id?: string } };
    const jobId = exportJob?.job?.id;

    if (!jobId) {
      throw createError(500, 'Não foi possível iniciar a exportação do design no Canva');
    }

    const exportResult = await waitForExport(userId, jobId);
    const job = exportResult.job as { urls?: string[] } | undefined;
    const urls = job?.urls || [];

    if (urls.length === 0) {
      throw createError(500, 'O Canva não retornou imagens exportadas para este design');
    }

    // Faz o download de cada página/asset gerado no Canva
    const downloadedFiles: Express.Multer.File[] = [];
    for (let i = 0; i < urls.length; i++) {
      const pageUrl = urls[i];
      const pageRes = await fetch(pageUrl);
      if (pageRes.ok) {
        const arrayBuf = await pageRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        downloadedFiles.push({
          fieldname: 'files',
          originalname: `canva-brandbook-page-${i + 1}.png`,
          encoding: '7bit',
          mimetype: 'image/png',
          buffer,
          size: buffer.length,
          stream: null as any,
          destination: '',
          filename: `canva-brandbook-page-${i + 1}.png`,
          path: '',
        });
      }
    }

    if (downloadedFiles.length === 0) {
      throw createError(500, 'Falha ao baixar páginas exportadas do Canva');
    }

    const result = await processBrandbookIngest({
      brandSlug: slug,
      files: downloadedFiles,
      uploadedByUserId: userId,
    });

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

// POST /api/brands/:slug/brandbook/confirm-logo - Confirmar substituição de logo oficial
// Requer papel EDITOR+ (mesmo padrão das rotas de ingest acima)
brandsRouter.post('/:slug/brandbook/confirm-logo', requireBrandRole(EDITORS), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const brand = req.brand!;
    const { logoUrl } = req.body;

    if (!logoUrl) throw createError(400, 'logoUrl é obrigatório');

    // Logo exportado de Canva/Word chega opaco e vira caixa branca em slide
    // escuro. Devolve a URL original quando não há o que converter.
    const logoFinal = await normalizarLogoParaFundoEscuro(logoUrl);

    await prisma.brandConfig.upsert({
      where: { brandId: brand.id },
      update: { logoUrl: logoFinal },
      create: {
        brandId: brand.id,
        agentPrompt: `Você é o assistente de design da marca ${brand.name}.`,
        guidelines: '',
        colors: [],
        primaryFonts: ['Inter'],
        logoUrl: logoFinal,
      },
    });

    // Sync: upsert de Asset com source 'branding' para que a logo apareça
    // na Biblioteca de Mídia sem precisar de upload duplicado no R2.
    // Usa o nome do arquivo da URL como identificador único dentro da marca.
    const fileName = logoFinal.split('/').pop() ?? 'logo';
    const existingLogoAsset = await prisma.asset.findFirst({
      where: { brandId: brand.id, source: 'branding' },
    });
    if (existingLogoAsset) {
      await prisma.asset.update({
        where: { id: existingLogoAsset.id },
        data: { url: logoFinal, name: fileName, updatedAt: new Date() },
      });
    } else {
      const ext = fileName.split('.').pop()?.toLowerCase() ?? 'svg';
      const fileType = ext === 'svg' ? 'image/svg+xml'
        : ext === 'png' ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : 'image/png';
      await prisma.asset.create({
        data: {
          brandId: brand.id,
          name: `Logo — ${brand.name}`,
          url: logoFinal,
          fileType,
          sizeBytes: 0,
          source: 'branding',
          tags: ['logo', 'branding'],
        },
      });
    }

    // Devolve a URL EFETIVA: se houve conversão, o frontend precisa passar a
    // exibir a transparente, não a que o usuário acabou de enviar.
    res.json({ message: 'Logo oficial atualizada com sucesso', data: { logoUrl: logoFinal } });
  } catch (error) {
    next(error);
  }
});

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
        config: { select: { logoUrl: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } }
      },
    });
    const mapped = brands.map(b => ({
      ...b,
      logoUrl: b.config?.logoUrl,
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
        config: { select: { logoUrl: true } },
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        accessRequests: { where: { userId, status: 'PENDING' } }
      },
    });
    const mapped = brands.map(b => ({
      ...b,
      logoUrl: b.config?.logoUrl,
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
// ?published=true devolve só as apresentações hospedadas (publicSlug setado),
// com um select enxuto (sem slides) — a lista de "Apresentações Publicadas"
// da sidebar não precisa do conteúdo inteiro de cada post, só o suficiente
// pra mostrar o link e o status.
brandsRouter.get('/:slug/posts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId } = (req as AuthRequest).user!;
    const slug = req.params.slug as string;
    const brand = await prisma.brand.findFirst({
      where: { slug, members: { some: { userId } } },
      select: { id: true },
    });
    if (!brand) throw createError(404, 'Brand not found');

    if (req.query.published === 'true') {
      const posts = await prisma.post.findMany({
        where: { brandId: brand.id, publishedAt: { not: null } },
        orderBy: { publishedAt: 'desc' },
        select: {
          id: true, name: true, type: true, previewUrl: true,
          publicSlug: true, publishedAt: true, hostingConfig: true, updatedAt: true,
        },
      });
      res.json({ data: posts });
      return;
    }

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

    // Ferramenta interna: a marca nova já nasce visível para a equipe inteira.
    ensureInternalTeamMemberships().catch(() => {});

    res.status(201).json({ data: brand });
  } catch (error) {
    next(error);
  }
});

// POST /api/brands/:slug/collabs - Cria um desdobramento (interno ou parceria) de um projeto-base.
//
// O desdobramento é uma marca ligada à base por `parentBrandId`: herda a identidade dela e guarda
// só o que muda (`collab`). Não pede de novo nada que já exista na base. Quem pode editar a base
// pode criar desdobramentos, e a equipe da base passa a enxergá-lo com os mesmos papéis.
// Desdobramento de desdobramento não existe: a herança é de um nível só, para a regra de
// "o que vale" continuar legível (global → base → desdobramento).
brandsRouter.post('/:slug/collabs', requireBrandRole(EDITORS), async (req: BrandRequest, res: Response, next: NextFunction) => {
  try {
    const input = parseBody(createCollabSchema, req.body ?? {});
    const parentRef = req.brand!;

    const parent = await prisma.brand.findUnique({
      where: { id: parentRef.id },
      select: { id: true, slug: true, color: true, kind: true, members: { select: { userId: true, role: true } } },
    });
    if (!parent) throw createError(404, 'Marca não encontrada.');
    if (parent.kind !== 'BASE') throw createError(400, 'Só um projeto-base pode ter desdobramentos.');

    // Logo e guia visual do parceiro têm de estar na biblioteca da base: sem isto o cliente
    // mandaria qualquer URL e o servidor iria buscá-la (SSRF) ou exporia arquivo de outra marca.
    const arquivos = [input.details.partner?.logoUrl, input.details.partner?.visualManualUrl].filter(
      (u): u is string => Boolean(u),
    );
    for (const url of arquivos) {
      const asset = await prisma.asset.findFirst({ where: { brandId: parent.id, url }, select: { id: true } });
      if (!asset) throw createError(400, 'O logo e o guia visual do parceiro precisam estar na biblioteca do projeto-base.');
    }

    const slug = collabSlug(parent.slug, input.name);
    if (await prisma.brand.findUnique({ where: { slug }, select: { id: true } })) {
      throw createError(409, 'Já existe um desdobramento com esse nome neste projeto.');
    }

    const collab = await prisma.brand.create({
      data: {
        name: input.name,
        slug,
        color: input.color ?? parent.color ?? '#171717',
        kind: input.kind,
        parentBrandId: parent.id,
        collab: input.details as Prisma.InputJsonValue,
        members: { create: parent.members.map((m) => ({ userId: m.userId, role: m.role })) },
      },
    });

    ensureInternalTeamMemberships().catch(() => {});

    res.status(201).json({ data: collab });
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
