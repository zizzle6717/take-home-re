import { RenewalRisk } from './pages/RenewalRisk';

// Lightweight path matcher — the spec rules out a router; reading
// `window.location.pathname` is sufficient because we only have one
// dynamic route (`/properties/:id/renewal-risk`).
const PROPERTY_ROUTE = /^\/properties\/([^/]+)\/renewal-risk\/?$/;

const matchPropertyId = (pathname: string): string | null => {
  const m = PROPERTY_ROUTE.exec(pathname);
  return m ? decodeURIComponent(m[1]!) : null;
};

export default function App() {
  const propertyId = matchPropertyId(window.location.pathname);

  return (
    <main className="container">
      {propertyId ? (
        <RenewalRisk propertyId={propertyId} />
      ) : (
        <section>
          <h1>Renewal Risk Dashboard</h1>
          <p>
            Visit <code>/properties/&lt;propertyId&gt;/renewal-risk</code> to view flagged residents.
          </p>
        </section>
      )}
    </main>
  );
}
