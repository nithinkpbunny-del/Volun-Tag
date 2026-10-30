import { Suspense, lazy } from "react";
import VolunTag from "./VolunTag";

// The admin console loads only on /admin, so its code and CSS stay out of the public app.
const AdminApp = lazy(() => import("./components/admin/AdminApp"));

const isAdminPath = window.location.pathname.replace(/\/+$/, "") === "/admin";

function App() {
  if (isAdminPath) {
    return (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    );
  }

  return <VolunTag />;
}

export default App;
