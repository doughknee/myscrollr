import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

/** All destinations are built from app-owned election source URLs. */
export default function SourceLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-primary underline"
      onClick={(event) => {
        event.preventDefault();
        void invoke("open_external", { url: href }).catch(() =>
          toast.error("Couldn’t open the results source in your browser."),
        );
      }}
    >
      {children}
    </a>
  );
}
