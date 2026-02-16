import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  NavLink,
} from "react-router";
import "./app.css";

const navItems = [
  { to: "/", label: "Dashboard", icon: "◉" },
  { to: "/providers", label: "Providers", icon: "⚡" },
  { to: "/configs", label: "Models", icon: "⚙" },
  { to: "/agents", label: "Agents", icon: "▶" },
  { to: "/projects", label: "Projects", icon: "◫" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="night">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>murder</title>
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-base-300">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 bg-base-200 border-r border-base-content/10 flex flex-col">
        <div className="p-4 border-b border-base-content/10">
          <h1 className="text-lg font-bold tracking-tight text-base-content">
            murder
          </h1>
          <p className="text-xs text-base-content/50 mt-0.5">
            a flock of agents
          </p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-base-content/70 hover:bg-base-content/5 hover:text-base-content"
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-base-content/10">
          <p className="text-xs text-base-content/30">v0.1.0</p>
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
