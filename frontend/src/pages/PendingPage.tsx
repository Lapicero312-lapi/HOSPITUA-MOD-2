export default function PendingPage({ title }: { title: string }) {
  return <div className="panel"><h2>{title}</h2><p className="note">Pantalla pendiente: se construye cuando su caso de uso tenga spec y plan.</p></div>;
}
