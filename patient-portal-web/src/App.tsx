import { Link, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { NursePage } from "./nurse/NursePage";
import { PatientPage } from "./patient/PatientPage";

function NotFound() {
  return (
    <AppShell area="Patient portal">
      <div className="m-auto text-center">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">There is nothing at this address.</p>
        <Link
          to="/"
          className="mt-4 inline-block font-medium text-brand-700 underline underline-offset-2"
        >
          Go to the patient portal
        </Link>
      </div>
    </AppShell>
  );
}

/** The nurse dashboard is not linked from the patient portal, but it is protected by role, not by being hidden. */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<PatientPage />} />
      <Route path="/nurse" element={<NursePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
