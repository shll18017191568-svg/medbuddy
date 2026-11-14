import Link from "next/link";
import { notFound } from "next/navigation";
import { LEGAL_DOCS, findLegalDoc } from "@/lib/legal";

export function generateStaticParams() {
  return LEGAL_DOCS.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = findLegalDoc(slug);
  return { title: doc ? `${doc.title} · MedBuddy` : "合规公示 · MedBuddy" };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = findLegalDoc(slug);
  if (!doc) notFound();

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← 返回工作台
      </Link>

      <header className="mt-6 border-b border-slate-200 pb-5">
        <h1 className="text-2xl font-bold text-slate-900">{doc.title}</h1>
        <p className="mt-2 text-sm text-slate-500">{doc.summary}</p>
        <p className="mt-2 text-xs text-slate-400">最后更新：{doc.updatedAt}</p>
      </header>

      <article className="mt-6 space-y-6">
        {doc.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-base font-semibold text-slate-800">{section.heading}</h2>
            {section.paragraphs?.map((text, i) => (
              <p key={i} className="mt-2 text-sm leading-relaxed text-slate-600">
                {text}
              </p>
            ))}
            {section.bullets && (
              <ul className="mt-2 space-y-1.5">
                {section.bullets.map((item, i) => (
                  <li key={i} className="text-sm leading-relaxed text-slate-600">
                    · {item}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </article>

      <footer className="mt-10 border-t border-slate-200 pt-5">
        <p className="text-xs text-slate-400">相关文本</p>
        <div className="mt-2 flex flex-wrap gap-4">
          {LEGAL_DOCS.filter((item) => item.slug !== doc.slug).map((item) => (
            <Link
              key={item.slug}
              href={`/legal/${item.slug}`}
              className="text-sm text-blue-600 hover:underline"
            >
              {item.title}
            </Link>
          ))}
        </div>
      </footer>
    </main>
  );
}
