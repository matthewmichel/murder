import { Link, useLoaderData } from "react-router";
import sql from "../lib/db.server";

interface DashboardData {
  providerCount: number;
  configuredKeyCount: number;
  agentCount: number;
  availableAgentCount: number;
  projectCount: number;
  memoryCount: number;
  conversationCount: number;
  capabilities: { capability: string; model_name: string; provider_name: string }[];
}

async function safeMemoryCount(): Promise<{ count: number }[]> {
  try {
    return await sql`SELECT count(*)::int AS count FROM mem0_memories` as any;
  } catch {
    return [{ count: 0 }];
  }
}

export async function loader() {
  const [providers, keys, agents, projects, memories, conversations, configs] =
    await Promise.all([
      sql`SELECT count(*)::int AS count FROM ai_providers`,
      sql`SELECT count(*)::int AS count FROM ai_provider_keys WHERE is_active = true`,
      sql`SELECT
            count(*)::int AS total,
            count(*) FILTER (WHERE is_available = true)::int AS available
          FROM agent_backends`,
      sql`SELECT count(*)::int AS count FROM projects`,
      safeMemoryCount(),
      sql`SELECT count(*)::int AS count FROM conversations`,
      sql`SELECT ac.capability, ac.model_name, ap.name AS provider_name
          FROM ai_configs ac
          JOIN ai_provider_keys apk ON apk.id = ac.provider_key_id
          JOIN ai_providers ap ON ap.id = apk.provider_id
          WHERE ac.project_id IS NULL AND ac.is_active = true
          ORDER BY ac.capability`,
    ]);

  return {
    providerCount: providers[0].count,
    configuredKeyCount: keys[0].count,
    agentCount: agents[0].total,
    availableAgentCount: agents[0].available,
    projectCount: projects[0].count,
    memoryCount: memories[0].count,
    conversationCount: conversations[0].count,
    capabilities: configs as unknown as DashboardData["capabilities"],
  } satisfies DashboardData;
}

const ALL_CAPABILITIES = ["embeddings", "chat", "decisions", "extraction"];

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();

  const configuredCaps = new Set(data.capabilities.map((c) => c.capability));

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="AI Providers"
          value={`${data.configuredKeyCount} / ${data.providerCount}`}
          subtitle="keys configured"
          to="/providers"
          status={data.configuredKeyCount > 0 ? "success" : "warning"}
        />
        <StatCard
          title="Agents"
          value={String(data.availableAgentCount)}
          subtitle={`of ${data.agentCount} detected`}
          to="/agents"
          status={data.availableAgentCount > 0 ? "success" : "warning"}
        />
        <StatCard
          title="Projects"
          value={String(data.projectCount)}
          subtitle="registered"
          to="/projects"
          status="info"
        />
        <StatCard
          title="Memories"
          value={String(data.memoryCount)}
          subtitle={`${data.conversationCount} conversations`}
          status="info"
        />
      </div>

      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="card-title text-base">Global Model Configuration</h3>
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ALL_CAPABILITIES.map((cap) => {
                  const config = data.capabilities.find(
                    (c) => c.capability === cap
                  );
                  return (
                    <tr key={cap}>
                      <td className="font-medium capitalize">{cap}</td>
                      <td>{config?.provider_name ?? "—"}</td>
                      <td>
                        {config ? (
                          <code className="text-xs">{config.model_name}</code>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {config ? (
                          <span className="badge badge-success badge-sm">
                            active
                          </span>
                        ) : (
                          <span className="badge badge-warning badge-sm">
                            not set
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!configuredCaps.size && (
            <div className="mt-2">
              <Link to="/configs" className="btn btn-primary btn-sm">
                Configure Models
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  to,
  status,
}: {
  title: string;
  value: string;
  subtitle: string;
  to?: string;
  status: "success" | "warning" | "info";
}) {
  const statusColor =
    status === "success"
      ? "text-success"
      : status === "warning"
        ? "text-warning"
        : "text-info";

  const content = (
    <div className="card bg-base-200 hover:bg-base-100 transition-colors">
      <div className="card-body p-4">
        <p className="text-xs uppercase tracking-wider text-base-content/50">
          {title}
        </p>
        <p className={`text-3xl font-bold ${statusColor}`}>{value}</p>
        <p className="text-sm text-base-content/60">{subtitle}</p>
      </div>
    </div>
  );

  if (to) {
    return <Link to={to}>{content}</Link>;
  }
  return content;
}
