import { ApiProperty } from '@nestjs/swagger';

/**
 * Un importe de la API con su moneda (`{ "amount": "220000.00", "currency": "COP" }`). El importe sale como
 * texto con dos decimales porque el dinero nunca pasa por `number` (plan base, "Dinero"). Es una clase para
 * que OpenAPI lo documente (plan base, "Contratos REST"), y en OpenAPI los nombres de las clases son
 * globales: toda respuesta con dinero usa esta, sin declarar otra.
 */
export class MoneyDto {
  @ApiProperty({
    description: 'Como texto, con dos decimales.',
    pattern: '^\\d+\\.\\d{2}$',
    example: '220000.00',
  })
  amount: string;

  @ApiProperty({
    description: 'Código ISO 4217.',
    pattern: '^[A-Z]{3}$',
    example: 'COP',
  })
  currency: string;
}
