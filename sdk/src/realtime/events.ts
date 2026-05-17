import EventEmitter from 'eventemitter3';
import type { EventMap } from '../types/index.js';

/**
 * Type-safe event emitter for FinBridge AI events.
 * Wraps eventemitter3 with a strict EventMap contract.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();

  on<K extends keyof EventMap>(event: K, listener: (data: EventMap[K]) => void): this {
    this.emitter.on(event as string, listener as (data: unknown) => void);
    return this;
  }

  once<K extends keyof EventMap>(event: K, listener: (data: EventMap[K]) => void): this {
    this.emitter.once(event as string, listener as (data: unknown) => void);
    return this;
  }

  off<K extends keyof EventMap>(event: K, listener: (data: EventMap[K]) => void): this {
    this.emitter.off(event as string, listener as (data: unknown) => void);
    return this;
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): boolean {
    return this.emitter.emit(event as string, data);
  }

  removeAllListeners(event?: keyof EventMap): this {
    this.emitter.removeAllListeners(event as string | undefined);
    return this;
  }

  listenerCount(event: keyof EventMap): number {
    return this.emitter.listenerCount(event as string);
  }
}
