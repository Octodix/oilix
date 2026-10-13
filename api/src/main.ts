import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { text } from 'express';
import { AppModule } from './app.module';
import { corsOriginOption } from './common/http/cors-origin';
import { ADMS_ALL_PATHS, ADMS_MAX_BODY } from './modules/hr/zkteco/adms-protocol';

function assertJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim() ?? '';
  const weak =
    !secret ||
    secret.length < 32 ||
    /dev-secret|change.?me|secret123|oilix-dev/i.test(secret);
  if (weak && process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET must be a strong unique value (≥32 chars) in production',
    );
  }
  if (weak) {
    console.warn(
      '[security] JWT_SECRET is weak or missing — set a strong secret before production deploy',
    );
  }
}

async function bootstrap() {
  assertJwtSecret();
  const app = await NestFactory.create(AppModule);

  // ZKTeco terminals post plain-text ATTLOG to fixed /iclock/* paths (no prefix, any content-type).
  app.use(
    ADMS_ALL_PATHS.map((p) => `/${p}`),
    text({ type: () => true, limit: ADMS_MAX_BODY }),
  );
  app.setGlobalPrefix('api/v1', {
    exclude: ADMS_ALL_PATHS.map((path) => ({ path, method: RequestMethod.ALL })),
  });
  app.enableCors({
    origin: corsOriginOption(),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Oilix API')
    .setDescription('واجهة برمجة تطبيقات إدارة المعصرة')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '0.0.0.0';
  const publicHost = process.env.PUBLIC_HOST ?? 'localhost';

  await app.listen(port, host);
  console.log(`API listening on http://${host}:${port}/api/v1`);
  console.log(`LAN access:  http://${publicHost}:${port}/api/v1`);
  console.log(`WebSocket:   http://${publicHost}:${port}/realtime`);
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true') {
    console.log(`Swagger:     http://${publicHost}:${port}/api/docs`);
  }
}
bootstrap();
