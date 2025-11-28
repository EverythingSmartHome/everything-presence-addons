import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  name: 'zone-configurator-backend',
  level: process.env.LOG_LEVEL ?? 'info',
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
        },
      },
});
