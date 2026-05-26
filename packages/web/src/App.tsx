import { Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { DraftPage } from "./routes/DraftPage";
import { DraftsPage } from "./routes/DraftsPage";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DraftsPage />} />
        <Route path="/drafts/:id" element={<DraftPage />} />
      </Route>
    </Routes>
  );
}
