import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { kafkaConsumerOptions } from './infra/messaging/kafka.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The same process consumes the events it publishes: the @EventPattern() handlers.
  app.connectMicroservice(kafkaConsumerOptions(app.get(ConfigService)), { inheritAppConfig: true });
  // On SIGTERM the relay stops claiming, finishes in-flight publishes and releases its leases.
  app.enableShutdownHooks();
  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
