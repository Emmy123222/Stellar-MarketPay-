import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../utils/errorHandler';
import { AppDataSource } from '../../db/dataSource';
import { Message } from '../../db/entities/Message';
import { Booking } from '../../db/entities/Booking';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../utils/errors';
import { getWebSocketServer } from '../../websockets/server';
import { logger } from '../../utils/logger';

const router = Router();

const sendMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

router.get(
  '/:jobId/messages',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const walletAddress = req.user?.walletAddress;

    const messageRepo = AppDataSource.getRepository(Message);
    const bookingRepo = AppDataSource.getRepository(Booking);

    const booking = await bookingRepo.findOne({ where: { id: jobId } });
    if (!booking) {
      throw new NotFoundError('Job not found');
    }

    if (booking.walletAddress !== walletAddress) {
      throw new ForbiddenError('You are not a participant in this job');
    }

    const [messages, total] = await messageRepo.findAndCount({
      where: { jobId },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    res.json({
      success: true,
      data: messages.reverse(),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  }),
);

router.post(
  '/:jobId/messages',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new BadRequestError('Validation error', parsed.error.flatten());
    }

    const { jobId } = req.params;
    const walletAddress = req.user?.walletAddress;

    const bookingRepo = AppDataSource.getRepository(Booking);
    const booking = await bookingRepo.findOne({ where: { id: jobId } });
    if (!booking) {
      throw new NotFoundError('Job not found');
    }

    if (booking.walletAddress !== walletAddress) {
      throw new ForbiddenError('Only job participants can send messages');
    }

    const messageRepo = AppDataSource.getRepository(Message);
    const message = messageRepo.create({
      jobId,
      senderAddress: walletAddress,
      content: parsed.data.content,
    });
    await messageRepo.save(message);

    try {
      const ws = getWebSocketServer();
      (ws as any).io?.to(`job:${jobId}`)?.emit('message:new', {
        id: message.id,
        jobId: message.jobId,
        senderAddress: message.senderAddress,
        content: message.content,
        createdAt: message.createdAt,
      });
    } catch (e) {
      logger.warn('WebSocket not available — skipping message broadcast');
    }

    res.status(201).json({
      success: true,
      data: message,
    });
  }),
);

export const messageRoutes = router;
