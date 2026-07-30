import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requestContext } from '../middleware/requestContext.js';
import { getAiContext } from '../lib/aiContext.js';
import { logger } from '../lib/logger.js';

// Mock logger methods
vi.mock('../lib/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('requestContext middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let finishCallback: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      headers: {},
      method: 'GET',
      originalUrl: '/test-route?token=abc',
    };

    res = {
      setHeader: vi.fn(),
      statusCode: 200,
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') {
          finishCallback = cb;
        }
        return res as Response;
      }),
    };

    next = vi.fn();
    finishCallback = undefined;
  });

  it('should use provided x-request-id header', () => {
    req.headers!['x-request-id'] = 'custom-test-id';

    // To verify getAiContext, we can capture it inside next
    next = vi.fn(() => {
      const context = getAiContext();
      expect(context.requestId).toBe('custom-test-id');
      expect(context.feature).toBe('http');
    });

    requestContext(req as Request, res as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'custom-test-id');
    expect(next).toHaveBeenCalled();
  });

  it('should generate a new x-request-id if none is provided', () => {
    // To verify getAiContext, we can capture it inside next
    let generatedId: string | undefined;

    next = vi.fn(() => {
      const context = getAiContext();
      generatedId = context.requestId;

      expect(generatedId).toBeDefined();
      expect(typeof generatedId).toBe('string');
      expect(generatedId?.length).toBeGreaterThan(0);
      expect(context.feature).toBe('http');
    });

    requestContext(req as Request, res as Response, next);

    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', generatedId);
    expect(next).toHaveBeenCalled();
  });

  it('should log info for 2xx status codes on finish', () => {
    requestContext(req as Request, res as Response, next);

    expect(finishCallback).toBeDefined();

    // Simulate finishing the request
    res.statusCode = 200;
    finishCallback!();

    expect(logger.info).toHaveBeenCalledWith('HTTP', expect.objectContaining({
      method: 'GET',
      path: '/test-route',
      status: 200,
      durationMs: expect.any(Number),
    }));
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should log warn for 4xx status codes on finish', () => {
    requestContext(req as Request, res as Response, next);

    expect(finishCallback).toBeDefined();

    // Simulate finishing the request
    res.statusCode = 404;
    finishCallback!();

    expect(logger.warn).toHaveBeenCalledWith('HTTP', expect.objectContaining({
      method: 'GET',
      path: '/test-route',
      status: 404,
      durationMs: expect.any(Number),
    }));
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should log error for 5xx status codes on finish', () => {
    requestContext(req as Request, res as Response, next);

    expect(finishCallback).toBeDefined();

    // Simulate finishing the request
    res.statusCode = 500;
    finishCallback!();

    expect(logger.error).toHaveBeenCalledWith('HTTP', expect.objectContaining({
      method: 'GET',
      path: '/test-route',
      status: 500,
      durationMs: expect.any(Number),
    }));
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
