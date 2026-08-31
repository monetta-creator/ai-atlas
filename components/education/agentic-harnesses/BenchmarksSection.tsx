// Spec 05: how to judge a harness. Server component, three stat cards + the
// network-default callout.

export default function BenchmarksSection() {
  return (
    <section id="benchmarks" className="edu-section">
      <div className="edu-eyebrow">Spec 05</div>
      <h2>How to judge one</h2>
      <p className="edu-lede">
        The scoreboards are noisier than they look, and the harness itself is a bigger lever than
        most buyers assume. The three cards below make the same point from three angles: the number
        you see depends on the scaffold that produced it.
      </p>

      <div className="edu-bench">
        <div className="edu-benchcard">
          <div className="num">~94%</div>
          <h4>SWE-bench Verified</h4>
          <p>
            The original standard. Frontier models now score in the low-to-mid 90s, and the set is
            flagged for contamination: newer models&apos; training data overlaps the test set. Kept
            mainly for historical comparison.
          </p>
        </div>
        <div className="edu-benchcard">
          <div className="num">59.1%</div>
          <h4>SWE-bench Pro</h4>
          <p>
            Scale AI&apos;s contamination-resistant successor, built from copyleft and private
            codebases. On the standardized public set (731 tasks, one shared scaffold) GPT-5.4
            leads at 59.1% as of August 2026. Vendor-reported runs on the same benchmark reach 80%,
            so any quoted score needs its split and scaffold named.
          </p>
        </div>
        <div className="edu-benchcard">
          <div className="num">~20 pts</div>
          <h4>Harness effect</h4>
          <p>
            The spread between 59.1% under Scale&apos;s standardized scaffold and 80% with
            vendor-chosen scaffolds is produced by harness and data split alone, holding the model
            class constant. Terminal-Bench 2.0 scores autonomous, multi-step execution end to end,
            and is emerging as the more relevant test.
          </p>
        </div>
      </div>

      <div className="edu-callout">
        <strong>One default worth checking:</strong> Codex CLI ships with network access disabled
        inside its sandbox, so any workflow that depends on current information needs it enabled
        explicitly. Claude Code, Devin, and Manus reach the live web out of the box; Claude Code&apos;s
        WebSearch tool runs on Anthropic&apos;s first-party API and is hidden when the CLI is pointed at
        Bedrock or Vertex.
      </div>
    </section>
  );
}
