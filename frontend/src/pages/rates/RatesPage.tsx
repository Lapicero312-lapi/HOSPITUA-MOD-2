import { useQuery } from '@tanstack/react-query';
import { ErrorMessage } from '../../components/ErrorMessage.tsx';
import {
  getReferenceRates,
  type Money,
  type ReferenceRate,
} from '../../services/rates.ts';
import './RatesPage.css';

/**
 * Pantalla "Tarifas" (spec de `calculate-dynamic-rate`, FR-009; plan, C1): una tarifa de referencia por
 * categoría, con la tarifa base, el ajuste de temporada y la tarifa efectiva por noche, y la nota de que
 * es ilustrativa. Es de solo lectura y no muestra la capacidad de las habitaciones (está en
 * "Habitaciones"). Los valores salen tal como los calcula el backend: la pantalla no hace cuentas.
 */
export function RatesPage() {
  return (
    <section className="rates ui-page">
      <header className="ui-page-header">
        <div>
          <h1 className="rates-title ui-page-title">Tarifas</h1>
        </div>
      </header>
      <div className="rates-panel ui-panel">
        <RatesContent />
      </div>
    </section>
  );
}

function RatesContent() {
  const rates = useQuery({
    queryKey: ['rates', 'reference'],
    queryFn: ({ signal }) => getReferenceRates(signal),
  });

  if (rates.isPending) {
    return (
      <p className="rates-state rates-state--loading ui-state ui-state--loading">
        Cargando tarifas…
      </p>
    );
  }
  if (rates.isError) {
    return <ErrorMessage error={rates.error} />;
  }
  return (
    <>
      {rates.data.items.length === 0 ? (
        <p className="rates-state ui-state">
          No hay tarifas de referencia configuradas.
        </p>
      ) : (
        <RatesTable rates={rates.data.items} />
      )}
      <p className="rates-note">{rates.data.note}</p>
    </>
  );
}

function RatesTable({ rates }: { rates: ReferenceRate[] }) {
  return (
    <div className="ui-scroll-x">
      <table className="rates-table ui-table ui-table--sticky">
        <thead>
          <tr>
            <th scope="col">Categoría</th>
            <th scope="col">Tarifa base</th>
            <th scope="col">Ajuste de temporada</th>
            <th scope="col">Tarifa efectiva / noche</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((rate) => (
            <tr key={rate.categoryRoom}>
              <td className="rates-category">{rate.categoryRoom}</td>
              <td className="rates-money">{formatMoney(rate.baseRate)}</td>
              <td className="rates-adjustment">
                {formatPercentage(rate.seasonAdjustmentPercentage)}
              </td>
              <td className="rates-money rates-effective">
                {formatMoney(rate.effectiveRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `220000.00 COP` como `220.000,00 COP`: puntos de miles y coma decimal, sin pasar por un número. */
function formatMoney(money: Money): string {
  const [whole, decimals = '00'] = money.amount.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimals} ${money.currency}`;
}

/**
 * `"15.00"` como `+15 %`, `"-12.50"` como `-12,5 %` y `"0.00"` como `0 %`: con su signo, coma decimal y
 * sin ceros de más, sin pasar por un número.
 */
function formatPercentage(percentage: string): string {
  const negative = percentage.startsWith('-');
  const [whole, decimals = ''] = percentage.replace(/^[-+]/, '').split('.');
  const trimmed = decimals.replace(/0+$/, '');
  const digits = trimmed === '' ? whole : `${whole},${trimmed}`;
  if (digits === '0') {
    return '0 %';
  }
  return `${negative ? '-' : '+'}${digits} %`;
}
