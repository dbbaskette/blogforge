import { Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { DraftsPage } from "./routes/DraftsPage";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DraftsPage />} />
        <Route path="/drafts/:id" element={<DraftPlaceholder />} />
      </Route>
    </Routes>
  );
}

function DraftPlaceholder(): JSX.Element {
  return <div className="text-slate-400">Draft page lands in Task 10.</div>;
}
