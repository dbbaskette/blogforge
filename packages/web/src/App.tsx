import { Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { AdminPage } from "./routes/AdminPage";
import { ComposePage } from "./routes/ComposePage";
import { DraftPage } from "./routes/DraftPage";
import { DraftsPage } from "./routes/DraftsPage";
import { LoginPage } from "./routes/LoginPage";
import { SettingsPage } from "./routes/SettingsPage";
import { TrashPage } from "./routes/TrashPage";
import { VoicePage } from "./routes/VoicePage";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        <Route
          path="/"
          element={
            <RequireAuth>
              <DraftsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/drafts/:id"
          element={
            <RequireAuth>
              <DraftPage />
            </RequireAuth>
          }
        />
        <Route
          path="/trash"
          element={
            <RequireAuth>
              <TrashPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/voice"
          element={
            <RequireAuth>
              <VoicePage />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth requireAdmin>
              <AdminPage />
            </RequireAuth>
          }
        />
        <Route
          path="/compose"
          element={
            <RequireAuth>
              <ComposePage />
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}
