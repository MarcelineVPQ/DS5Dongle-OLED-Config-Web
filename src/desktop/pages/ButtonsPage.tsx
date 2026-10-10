import RemapEditor from "../../components/RemapEditor";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import TriggersPage from "./TriggersPage";

// Everything about what the controls do: remapping and the trigger test.
export default function ButtonsPage({ bridge }: { bridge: UseDs5BridgeResult }) {
  return (
    <div className="dk-stack">
      <section className="dk-card">
        <RemapEditor client={bridge.client} />
      </section>
      <TriggersPage bridge={bridge} />
    </div>
  );
}
