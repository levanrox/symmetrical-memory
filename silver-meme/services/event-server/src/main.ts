import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule, configureApp } from './app.module';
import { connectionInfo } from './database';

async function bootstrap(): Promise<void> {
  const logger = new Logger('event-server');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  configureApp(app);

  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen(port, host);

  logger.log(`listening on http://${host}:${port}/api`);
  logger.log(`websocket at ws://${host}:${port}/ws?channel=admin`);
  logger.log(`database ${connectionInfo()}`);
  logger.log(`preflight: http://${host}:${port}/api/status`);
}

void bootstrap();
