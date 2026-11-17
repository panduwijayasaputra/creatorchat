import { Module } from '@nestjs/common';
import { createObjectStorage, type ServerEnv } from '@creatorchat/backend-core';
import { ENV } from '../../common/infra/tokens.js';
import { STORAGE } from './tokens.js';

/** The one object storage (`ObjectStorage | null`) shared by every module that signs links. */
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [ENV],
      useFactory: (env: ServerEnv) => createObjectStorage(env),
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
