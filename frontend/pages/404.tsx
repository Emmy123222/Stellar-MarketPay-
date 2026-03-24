import Link from "next/link";

export default function Custom404() {
    return (
        <main className="min-h-screen flex items-center justify-center text-white px-6">
            <div className="text-center w-full max-w-2xl ">
                <h1 className="text-8xl md:text-9xl font-display font-black bg-gradient-to-r from-market-400 via-market-600 to-market-400 bg-clip-text text-transparent lg:text-[12rem]">
                    404
                </h1>

                <h2 className="mt-6 text-2xl md:text-3xl font-semibold">
                    Page Not Found
                </h2>

                <p className="mt-4 text-amber-100 text-base md:text-lg">
                    This job or page does not exist
                </p>

                <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                    <Link href="/">
                        <button className="btn-primary text-base px-8 py-3.5">
                            Go Home
                        </button>
                    </Link>

                    <Link href="/jobs">
                        <button className="btn-secondary text-base px-8 py-3.5">
                            Browse Jobs
                        </button>
                    </Link>
                </div>
            </div>
        </main>
    );
}
