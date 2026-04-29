/**
 * pages/jobs/category/[slug].tsx
 * SEO-friendly category page for job listings.
 */
import { GetStaticPaths, GetStaticProps } from "next";
import Head from "next/head";
import JobCard from "@/components/JobCard";
import { fetchJobs } from "@/lib/api";
import { JOB_CATEGORIES, categoryToSlug, slugToCategory, CATEGORY_ICONS } from "@/utils/format";
import type { Job } from "@/utils/types";
import Link from "next/link";

interface CategoryPageProps {
  category: string;
  jobs: Job[];
  slug: string;
}

export default function CategoryPage({ category, jobs, slug }: CategoryPageProps) {
  const icon = CATEGORY_ICONS[category] || "🗂️";
  const title = `${category} Jobs | Stellar MarketPay`;
  const description = `Browse the latest ${category} jobs on Stellar MarketPay. Trustless escrow and instant payments for freelancers.`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={`https://marketpay.stellar.org/jobs/category/${slug}`} />
      </Head>

      <div className="mb-8">
        <Link href="/jobs" className="text-market-400 hover:text-market-300 text-sm mb-4 inline-block">
          ← Back to all jobs
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-4xl">{icon}</span>
          <div>
            <h1 className="font-display text-3xl font-bold text-amber-100">{category} Jobs</h1>
            <p className="text-amber-800 text-sm">{jobs.length} open position{jobs.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="card text-center py-16">
          <p className="font-display text-xl text-amber-100 mb-2">No jobs in this category yet</p>
          <p className="text-amber-800 text-sm mb-6">Be the first to post a {category} job!</p>
          <Link href="/post-job" className="btn-primary text-sm">Post a Job →</Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  const paths = JOB_CATEGORIES.map((cat) => ({
    params: { slug: categoryToSlug(cat) },
  }));

  return {
    paths,
    fallback: "blocking", // Allows for new categories to be added without a full rebuild
  };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const slug = params?.slug as string;
  const category = slugToCategory(slug);

  if (!category) {
    return {
      notFound: true,
    };
  }

  try {
    const result = await fetchJobs({ category, status: "open", limit: 50 });
    return {
      props: {
        category,
        jobs: result.jobs,
        slug,
      },
      revalidate: 60, // Refresh every minute
    };
  } catch (error) {
    console.error("Error fetching jobs for category:", error);
    return {
      props: {
        category,
        jobs: [],
        slug,
      },
      revalidate: 60,
    };
  }
};
