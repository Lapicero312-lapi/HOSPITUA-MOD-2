import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { GuestRepository } from '../../../../application/ports/out/guest.repository.js';
import type { Guest } from '../../../../domain/guest/guest.js';
import type { DocumentType } from '../../../../domain/shared/enums.js';
import { guestToDomain } from '../mappers/guest.mapper.js';
import { GuestTable } from '../tables/reservation.tables.js';

@Injectable()
export class TypeOrmGuestRepository implements GuestRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findLatestByDocument(
    documentType: DocumentType,
    documentNumber: string,
  ): Promise<Guest | null> {
    const row = await this.dataSource
      .getRepository(GuestTable)
      .createQueryBuilder('guest')
      .innerJoin('guest.reservation', 'reservation')
      .where('guest.documentType = :documentType', { documentType })
      .andWhere('guest.documentNumber = :documentNumber', { documentNumber })
      .orderBy('reservation.createdAt', 'DESC')
      .limit(1)
      .getOne();
    return row ? guestToDomain(row) : null;
  }
}
