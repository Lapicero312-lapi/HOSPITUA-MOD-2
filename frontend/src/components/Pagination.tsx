export default function Pagination({
  page,
  totalPages,
  totalItems,
  onChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="pager">
      <span className="note">
        {totalItems} {totalItems === 1 ? 'reserva' : 'reservas'}
      </span>
      {totalPages > 1 && (
        <div className="pagerbtns">
          <button
            className="btn sm"
            disabled={page <= 1}
            onClick={() => onChange(page - 1)}
          >
            ‹ Anterior
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              className={`btn sm${n === page ? ' primary' : ''}`}
              aria-current={n === page}
              onClick={() => onChange(n)}
            >
              {n}
            </button>
          ))}
          <button
            className="btn sm"
            disabled={page >= totalPages}
            onClick={() => onChange(page + 1)}
          >
            Siguiente ›
          </button>
        </div>
      )}
    </div>
  );
}
