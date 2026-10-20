import {Global, Injectable, OnModuleDestroy, OnModuleInit} from '@nestjs/common';
import {PrismaPg} from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';




@Global()
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor() {
        const adapter = new PrismaPg({connectionString: process.env.DATABASE_URL})
        super({adapter});
    }

    async onModuleInit() {
        console.log('DATABASE successfully connected!')
        await this.$connect()
    }

    async onModuleDestroy(){
        await this.$disconnect()
    }
}