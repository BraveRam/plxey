import { and, desc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, adminReplyTargets } from "@tg-business/db";

export interface OwnerReplyTarget {
  token: string;
  botId: string;
  chatId: number;
  businessConnectionId: string;
  customerLabel: string | null;
  promptMessageId: number | null;
}

export interface CreateOwnerReplyTarget {
  botId: string;
  chatId: number;
  businessConnectionId: string;
  customerLabel?: string;
}

export interface AdminReplyTargets {
  create(target: CreateOwnerReplyTarget): Promise<string>;
  activate(ownerTelegramId: string, token: string): Promise<OwnerReplyTarget | null>;
  setPromptMessageId(token: string, promptMessageId: number): Promise<void>;
  getActive(ownerTelegramId: string): Promise<OwnerReplyTarget | null>;
  markUsed(token: string): Promise<void>;
  /**
   * Clear the active selection on `token` without marking it used. After
   * this call the token can be re-activated (e.g. the owner taps Reply
   * on the original notification again). Used by the Cancel button so a
   * cancellation isn't a dead-end.
   */
  clearSelection(token: string): Promise<void>;
  clearBot(botId: string): Promise<void>;
}

interface StoredOwnerReplyTarget extends CreateOwnerReplyTarget {
  selectedByOwnerTelegramId: string | null;
  selectedAt: Date | null;
  promptMessageId: number | null;
  usedAt: Date | null;
}

export type AdminReplyTargetStorage = Map<string, StoredOwnerReplyTarget>;

function createReplyToken(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

export function createReplyCallbackData(replyToken: string): string {
  return `oreply_${replyToken}`;
}

export function createReplyCancelCallbackData(replyToken: string): string {
  return `oreply_cancel_${replyToken}`;
}

export class InMemoryAdminReplyTargets implements AdminReplyTargets {
  constructor(
    private tokenFactory: () => string = createReplyToken,
    private targets: AdminReplyTargetStorage = new Map(),
  ) {}

  setTokenFactory(tokenFactory: () => string): void {
    this.tokenFactory = tokenFactory;
  }

  async create(target: CreateOwnerReplyTarget): Promise<string> {
    let token = this.tokenFactory();
    while (this.targets.has(token)) token = this.tokenFactory();
    this.targets.set(token, {
      ...target,
      selectedByOwnerTelegramId: null,
      selectedAt: null,
      promptMessageId: null,
      usedAt: null,
    });
    return token;
  }

  async activate(ownerTelegramId: string, token: string): Promise<OwnerReplyTarget | null> {
    const target = this.targets.get(token);
    if (!target || target.usedAt) return null;
    this.clearActiveSelection(ownerTelegramId);
    target.selectedByOwnerTelegramId = ownerTelegramId;
    target.selectedAt = new Date();
    target.promptMessageId = null;
    return this.toOwnerReplyTarget(token, target);
  }

  async setPromptMessageId(token: string, promptMessageId: number): Promise<void> {
    const target = this.targets.get(token);
    if (target) target.promptMessageId = promptMessageId;
  }

  async getActive(ownerTelegramId: string): Promise<OwnerReplyTarget | null> {
    let newest: [string, StoredOwnerReplyTarget] | null = null;
    for (const entry of this.targets.entries()) {
      const [, target] = entry;
      if (target.selectedByOwnerTelegramId !== ownerTelegramId || target.usedAt || !target.selectedAt) continue;
      if (!newest || target.selectedAt > newest[1].selectedAt!) newest = entry;
    }
    if (!newest) return null;
    return this.toOwnerReplyTarget(newest[0], newest[1]);
  }

  async markUsed(token: string): Promise<void> {
    const target = this.targets.get(token);
    if (target) target.usedAt = new Date();
  }

  async clearSelection(token: string): Promise<void> {
    const target = this.targets.get(token);
    if (!target || target.usedAt) return;
    target.selectedByOwnerTelegramId = null;
    target.selectedAt = null;
    target.promptMessageId = null;
  }

  async clearBot(botId: string): Promise<void> {
    for (const [token, target] of this.targets) {
      if (target.botId === botId) this.targets.delete(token);
    }
  }

  private toOwnerReplyTarget(token: string, target: StoredOwnerReplyTarget): OwnerReplyTarget {
    return {
      token,
      botId: target.botId,
      chatId: target.chatId,
      businessConnectionId: target.businessConnectionId,
      customerLabel: target.customerLabel ?? null,
      promptMessageId: target.promptMessageId,
    };
  }

  private clearActiveSelection(ownerTelegramId: string): void {
    for (const target of this.targets.values()) {
      if (target.selectedByOwnerTelegramId !== ownerTelegramId || target.usedAt) continue;
      target.selectedByOwnerTelegramId = null;
      target.selectedAt = null;
      target.promptMessageId = null;
    }
  }
}

export class DbAdminReplyTargets implements AdminReplyTargets {
  constructor(
    private database = db,
    private tokenFactory: () => string = createReplyToken,
  ) {}

  async create(target: CreateOwnerReplyTarget): Promise<string> {
    let token = this.tokenFactory();
    while (await this.exists(token)) token = this.tokenFactory();

    await this.database.insert(adminReplyTargets).values({
      token,
      tenantBotId: target.botId,
      telegramChatId: String(target.chatId),
      businessConnectionId: target.businessConnectionId,
      customerLabel: target.customerLabel ?? null,
    });

    return token;
  }

  async activate(ownerTelegramId: string, token: string): Promise<OwnerReplyTarget | null> {
    const target = await this.findUnusedByToken(token);
    if (!target) return null;

    await this.database
      .update(adminReplyTargets)
      .set({
        selectedByOwnerTelegramId: null,
        selectedAt: null,
        promptMessageId: null,
      })
      .where(and(
        eq(adminReplyTargets.selectedByOwnerTelegramId, ownerTelegramId),
        isNull(adminReplyTargets.usedAt),
      ));

    await this.database
      .update(adminReplyTargets)
      .set({
        selectedByOwnerTelegramId: ownerTelegramId,
        selectedAt: new Date(),
        promptMessageId: null,
      })
      .where(eq(adminReplyTargets.token, token));

    return this.toOwnerReplyTarget({
      ...target,
      selectedByOwnerTelegramId: ownerTelegramId,
      promptMessageId: null,
    });
  }

  async setPromptMessageId(token: string, promptMessageId: number): Promise<void> {
    await this.database
      .update(adminReplyTargets)
      .set({ promptMessageId: String(promptMessageId) })
      .where(eq(adminReplyTargets.token, token));
  }

  async getActive(ownerTelegramId: string): Promise<OwnerReplyTarget | null> {
    const target = await this.database.query.adminReplyTargets.findFirst({
      where: and(
        eq(adminReplyTargets.selectedByOwnerTelegramId, ownerTelegramId),
        isNull(adminReplyTargets.usedAt),
      ),
      orderBy: [desc(adminReplyTargets.selectedAt)],
    });
    if (!target || !target.selectedAt) return null;
    return this.toOwnerReplyTarget(target);
  }

  async markUsed(token: string): Promise<void> {
    await this.database
      .update(adminReplyTargets)
      .set({ usedAt: new Date() })
      .where(eq(adminReplyTargets.token, token));
  }

  async clearSelection(token: string): Promise<void> {
    await this.database
      .update(adminReplyTargets)
      .set({
        selectedByOwnerTelegramId: null,
        selectedAt: null,
        promptMessageId: null,
      })
      .where(
        and(eq(adminReplyTargets.token, token), isNull(adminReplyTargets.usedAt)),
      );
  }

  async clearBot(botId: string): Promise<void> {
    await this.database
      .delete(adminReplyTargets)
      .where(eq(adminReplyTargets.tenantBotId, botId));
  }

  private async exists(token: string): Promise<boolean> {
    const existing = await this.database.query.adminReplyTargets.findFirst({
      where: eq(adminReplyTargets.token, token),
      columns: { token: true },
    });
    return Boolean(existing);
  }

  private async findUnusedByToken(token: string): Promise<typeof adminReplyTargets.$inferSelect | null> {
    const target = await this.database.query.adminReplyTargets.findFirst({
      where: and(eq(adminReplyTargets.token, token), isNull(adminReplyTargets.usedAt)),
    });
    return target ?? null;
  }

  private toOwnerReplyTarget(target: typeof adminReplyTargets.$inferSelect): OwnerReplyTarget {
    return {
      token: target.token,
      botId: target.tenantBotId,
      chatId: Number(target.telegramChatId),
      businessConnectionId: target.businessConnectionId,
      customerLabel: target.customerLabel,
      promptMessageId: target.promptMessageId
        ? Number(target.promptMessageId)
        : null,
    };
  }
}
