/**
 * components/insights/SkillsList.tsx
 * List of top skills with demand information
 */
import type { InsightSkill } from "@/lib/api";

interface Props {
  skills: InsightSkill[];
}

export default function SkillsList({ skills }: Props) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="section-title">Top skills</h2>
          <p className="mt-2 text-sm text-amber-800">
            Most requested skill tags, with a quick read on competition pressure.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {skills.map((skill, index) => (
          <div
            key={skill.skill}
            className="rounded-2xl border border-[rgba(251,191,36,0.08)] bg-ink-800/80 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-amber-100">
                  {index + 1}. {skill.skill}
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  Average applications per job: {skill.avgApplicationsPerJob.toFixed(1)}
                </p>
              </div>
              <div className="text-right">
                <span className="inline-flex rounded-full border border-market-500/20 bg-market-500/10 px-2.5 py-1 text-xs font-semibold text-market-300">
                  {skill.demandCount} listings
                </span>
                <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-amber-800">
                  {skill.lowCompetitionJobs} low-comp jobs
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
