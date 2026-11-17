import { Suspense, lazy } from "react";
import { BrowserRouter } from "react-router-dom";
import VolunTag from "./VolunTag";

// The admin console loads only under /admin, so its code and CSS stay out of the public app.
const AdminApp = lazy(() => import("./components/admin/AdminApp"));

// Matches /admin and anything below it (/admin/, /admin/x), but not /administrator.
const adminPath = window.location.pathname;
const isAdminPath = adminPath === "/admin" || adminPath.startsWith("/admin/");

function App() {
  // The admin console has its own screens and token and runs without a router.
  if (isAdminPath) {
    return (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    );
  }

  return (
    <BrowserRouter>
      <VolunTag />
    </BrowserRouter>
  );
}

export default App;
