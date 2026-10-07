import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport, type KafkaOptions } from '@nestjs/microservices';
import { ClientProxyTransport } from '@nestjs/outbox';
import { Partitioners } from 'kafkajs';

export const KAFKA_CLIENT = 'KAFKA_CLIENT';

/** The broker connection shared by the producer and the consumer. */
function kafkaClientConfig(config: ConfigService) {
  return {
    clientId: config.get('KAFKA_CLIENT_ID', 'orders-api'),
    brokers: config.getOrThrow<string>('KAFKA_BROKERS').split(','),
  };
}

/** The producer the outbox relay publishes through (KAFKA_BROKERS, comma-separated). */
export const KafkaClientModule = ClientsModule.registerAsync([
  {
    name: KAFKA_CLIENT,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({
      transport: Transport.KAFKA,
      options: {
        client: kafkaClientConfig(config),
        // Publishes only: no consumer group to join, no reply topics.
        producerOnlyMode: true,
        producer: { createPartitioner: Partitioners.DefaultPartitioner },
        // acks from every in-sync replica, so "published" means the broker stored it.
        send: { acks: -1 },
      },
    }),
  },
]);

/**
 * The consumer behind the `@EventPattern()` handlers. Every handler joins one consumer group
 * (Nest appends `-server` to its id). A handler that throws leaves the offset uncommitted, so
 * kafkajs redelivers the message: handlers deduplicate through `OutboxInbox`.
 */
export function kafkaConsumerOptions(config: ConfigService): KafkaOptions {
  return {
    transport: Transport.KAFKA,
    options: {
      client: kafkaClientConfig(config),
      consumer: { groupId: config.get('KAFKA_GROUP_ID', 'orders-api') },
      // The server also builds a producer (for replies); set its partitioner like the client's.
      producer: { createPartitioner: Partitioners.DefaultPartitioner },
      // A new group starts at the oldest message, so events published before it existed aren't skipped.
      subscribe: { fromBeginning: true },
    },
  };
}

/**
 * Publishes outbox messages to the Kafka topic named after the outbox topic.
 *
 * The record is built here instead of passing the envelope as is: Nest's Kafka serializer
 * reads any object with a `key` property as a `{ key, value }` record, and the envelope has
 * one, so its value would go out as null. The message key becomes the Kafka key, which keeps
 * one order's events on one partition, in order. Delivery is at-least-once: consumers
 * deduplicate on the envelope's `id` (also in the `outbox-message-id` header).
 */
export const KafkaOutboxTransport = ClientProxyTransport(KAFKA_CLIENT, {
  toPacket: (message, envelope) => ({
    pattern: message.topic,
    data: {
      key: message.key ?? undefined,
      value: envelope,
      headers: { ...message.headers, 'outbox-message-id': message.id },
    },
  }),
});
