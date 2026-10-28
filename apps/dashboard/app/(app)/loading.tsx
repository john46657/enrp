export default function Loading() {
  return (
    <div className="loading" role="status">
      <span className="loading__bar" aria-hidden="true" />
      <span>Daten werden geladen …</span>
    </div>
  );
}
