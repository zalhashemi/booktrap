import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CONTACT_EMAIL, OPERATOR, contactHref } from '../legal';

/** Both pages are drafts for the operator's or a lawyer's review before launch (PROGRESS.md, Phase 10). */
const LAST_UPDATED = '12 October 2026';

/**
 * How long things are kept. These mirror the API's defaults (POST_CACHE_DAYS, the 2-day network hash,
 * the 30-day Undo bin): change them together.
 */
const CACHE_DAYS = 90;

function Mail({ subject, children }: { subject?: string; children?: ReactNode }) {
  return (
    <a href={contactHref(subject)} className="font-bold text-accent-ink underline">
      {children ?? CONTACT_EMAIL}
    </a>
  );
}

function LegalPage({ title, note, summary, children }: { title: string; note: string; summary: ReactNode; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · BookTrap`;
    return () => {
      document.title = 'BookTrap';
    };
  }, [title]);

  return (
    <article className="max-w-[68ch]">
      <h1 className="font-display text-[2.4rem] leading-[1.05] text-balance md:text-[3.1rem]">{title}</h1>
      <p className="mt-3 text-sm text-text-muted">
        Last updated {LAST_UPDATED}. {OPERATOR}, Kingdom of Bahrain.
      </p>

      <section aria-labelledby="short-version" className="mt-8 rounded-card bg-surface p-5 shadow-[inset_0_0_0_1.5px_var(--rule)] md:p-6">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 id="short-version" className="font-display text-[1.5rem]">
            The short version
          </h2>
          <span className="marginalia" aria-hidden="true">
            {note}
          </span>
        </div>
        <ul className="mt-3 list-disc space-y-2 pl-5 leading-[1.55] marker:text-text-faint">{summary}</ul>
      </section>

      <div className="mt-10">{children}</div>

      <p className="mt-12 text-sm text-text-muted">
        Questions? Write to <Mail />.{' '}
        <Link to="/settings" className="underline">
          Back to Settings
        </Link>
      </p>
    </article>
  );
}

function H2({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-24 font-display text-[1.5rem] leading-snug first:mt-0">
      {children}
    </h2>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 leading-[1.6]">{children}</p>;
}

function List({ children }: { children: ReactNode }) {
  return <ul className="mt-3 list-disc space-y-2 pl-5 leading-[1.6] marker:text-text-faint">{children}</ul>;
}

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      note="no ads, no tracking"
      summary={
        <>
          <li>No tracking cookies, no ads, no analytics. You can use BookTrap as a guest, without an email.</li>
          <li>If you save your shelf, we keep your email address to sign you in. We keep your shelf until you delete it; an unsaved guest shelf goes after 30 days without a visit.</li>
          <li>To find books, we read the public posts you paste. We keep the book titles, the post link and the creator&rsquo;s public handle, never the video or images.</li>
          <li>
            You can export your shelf at any time, and <Link to="/settings#your-data" className="underline">delete it</Link> from Settings.
          </li>
        </>
      }
    >
      <H2>Who we are</H2>
      <P>
        BookTrap is run by {OPERATOR} in the Kingdom of Bahrain, which decides how your data is used (the &ldquo;controller&rdquo; under
        Bahrain&rsquo;s Personal Data Protection Law, Law No. 30 of 2018, and, for visitors in the European Union or the United Kingdom,
        the GDPR). Contact: <Mail subject="BookTrap privacy" />.
      </P>

      <H2>What we collect, and why</H2>
      <List>
        <li>
          <strong>Your sign-in.</strong> On your first visit you get a guest account: a random id, with no name, email or phone. If
          you save your shelf, we add your email address, and your password if you choose one (stored only as a one-way hash, by
          Supabase). We use your email only to sign you in and to send sign-in codes.
        </li>
        <li>
          <strong>Your shelf.</strong> The books you collect, with their status, shelves, notes and ISBNs, and for each book the
          posts it came from: the post link, the creator&rsquo;s public handle and the post&rsquo;s thumbnail link.
        </li>
        <li>
          <strong>The links you paste</strong> and how reading them went, so you can follow progress and retry.
        </li>
        <li>
          <strong>Your network address</strong>, used to enforce the daily limits. We store it only as a keyed hash, and clear even
          that after 2 days. Our own logs don&rsquo;t record it. Our hosting providers may keep short-lived security logs that
          include it.
        </li>
        <li>
          <strong>Usage costs</strong> (what reading each post cost us), to keep the service within its budget.
        </li>
      </List>
      <P>
        In your browser we store your sign-in session and display choices such as the theme. These stay on your device and
        aren&rsquo;t used for tracking.
      </P>

      <H2>Reading public posts</H2>
      <P>
        When you paste a TikTok or Instagram link, we fetch that public post (signed out), look at its video frames or photos, caption
        and any subtitles, and work out which books it shows. The video, images and caption are processed temporarily and not kept. We
        keep the books found, the post link, the creator&rsquo;s handle and the thumbnail link in a shared cache for up to {CACHE_DAYS}{' '}
        days, so the same post isn&rsquo;t read twice. We never republish anyone&rsquo;s photos or videos, and we can&rsquo;t read
        private posts or private collections.
      </P>
      <P>
        If you&rsquo;re a creator and want your handle or post removed from BookTrap, see{' '}
        <a href="#creators" className="underline">
          For creators
        </a>
        .
      </P>

      <H2>Who processes it for us</H2>
      <P>We use these providers to run BookTrap. Each handles only what its job needs:</P>
      <List>
        <li>
          <strong>Supabase</strong>: the database that holds shelves, and sign-in.
        </li>
        <li>
          <strong>Resend</strong>: sends the sign-in emails, so it sees your email address and the code or link in them.
        </li>
        <li>
          <strong>Render</strong>: runs the BookTrap server.
        </li>
        <li>
          <strong>Cloudflare</strong>: serves this website. Its Turnstile check also confirms that whoever starts a shelf or signs in
          isn&rsquo;t a bot, using signals from your browser. It doesn&rsquo;t set tracking cookies.
        </li>
        <li>
          <strong>Apify</strong>: fetches the public posts you paste from TikTok and Instagram.
        </li>
        <li>
          <strong>Anthropic</strong> (Claude): reads a post&rsquo;s frames, caption and subtitles to identify the books. Under its
          commercial terms, it doesn&rsquo;t train its models on this data.
        </li>
        <li>
          <strong>Google Books</strong> and <strong>Open Library</strong>: we send them book titles and authors (never anything about
          you) to find covers and ISBNs.
        </li>
      </List>
      <P>
        These providers process data outside Bahrain, including in the United States and the European Union. We rely on their data
        processing terms to protect it there.
      </P>

      <H2>Why we&rsquo;re allowed to</H2>
      <P>
        We process your shelf and the links you paste because you ask us to: it&rsquo;s the service itself. We process network hashes,
        costs and the bot check because we have a legitimate interest in preventing abuse and keeping BookTrap free. A creator&rsquo;s public handle
        is kept as the source of a book, so you can go back to the post, which is a legitimate interest too. You can object at any
        time.
      </P>

      <H2>How long we keep it</H2>
      <List>
        <li>Your account, shelf, its sources and your paste history: until you delete your account.</li>
        <li>A guest shelf that was never saved: 30 days after your last visit.</li>
        <li>Books you delete: 30 days in the Undo bin, then gone for good.</li>
        <li>Cached posts: {CACHE_DAYS} days.</li>
        <li>Network hashes: 2 days.</li>
        <li>Usage costs: kept for accounting, without your account once it&rsquo;s deleted.</li>
      </List>

      <H2>Your rights</H2>
      <P>
        You can see, correct, export and delete your data. Most of it you can do yourself: edit any book, export everything as CSV
        or JSON from the Export sheet or Settings, and delete your account and shelf under{' '}
        <Link to="/settings#your-data" className="underline">
          Settings, Your data
        </Link>
        , which removes it from our servers at once. You can also object to processing, or ask us to restrict it.
      </P>
      <P>
        For anything else, email us from the address your shelf is saved with (we can&rsquo;t identify a guest shelf by email).
        Never send your password or a sign-in code. We answer within 30 days. You can also complain
        to Bahrain&rsquo;s Personal Data Protection Authority, or, in the EU or UK, to your local data protection authority.
      </P>

      <H2 id="reports">Reports and the content check</H2>
      <P>
        When BookTrap reads a post, it also checks whether the post itself shows explicit or graphic content that isn&rsquo;t a book (book
        covers and talk about adult books are fine). Such a post is skipped: nothing from it is added, and the result is kept in the shared
        cache so the post isn&rsquo;t read again.
      </P>
      <P>
        You can report a post from a book&rsquo;s sources (the &ldquo;more&rdquo; button, then Report this post). A report keeps the post link,
        the creator&rsquo;s handle, the reason, your note if you write one, and which account sent it. Only we see reports, and the creator
        isn&rsquo;t told who sent one. If you delete your account, your reports stay without your account attached. A post we take down is
        removed from every shelf and isn&rsquo;t read again, whoever pastes it.
      </P>

      <H2 id="creators">For creators</H2>
      <P>
        BookTrap only reads public posts that its users paste, and keeps the book titles, the post link, your public handle and the
        thumbnail link. To have your handle and posts removed from our cache and from the sources shown on shelves, email{' '}
        <Mail subject="BookTrap removal request" /> with the post links or your handle. We remove them within 14 days, and the posts
        aren&rsquo;t read again. A book found only in a removed post leaves the shelves it was on, unless a reader had already marked it, written
        notes on it or put it on one of their shelves: then it stays, without your post.
      </P>

      <H2>Children</H2>
      <P>BookTrap isn&rsquo;t meant for children under 13, and we don&rsquo;t knowingly collect their data.</P>

      <H2>Changes</H2>
      <P>If we change this policy, we&rsquo;ll update the date at the top. Big changes will be noted in the app.</P>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      note="be kind to the bookworm"
      summary={
        <>
          <li>BookTrap is free, has daily limits and comes as it is.</li>
          <li>Only paste links to public posts, and don&rsquo;t try to get around the limits.</li>
          <li>Books are found automatically and can be wrong, so check before you buy.</li>
          <li>Save your shelf with an email to keep it: a guest shelf lives in one browser and goes after 30 days without a visit.</li>
        </>
      }
    >
      <H2>The service</H2>
      <P>
        BookTrap ({OPERATOR}) finds the books in TikTok and Instagram posts you paste and keeps them on a shelf you can export. It&rsquo;s
        free. It has daily limits, a monthly budget and a cap on videos per collection, all of which may change. If we ever offer paid
        features, they&rsquo;ll come with their own terms. By using BookTrap you agree to these terms and to the{' '}
        <Link to="/privacy" className="underline">
          privacy policy
        </Link>
        .
      </P>

      <H2>Using it fairly</H2>
      <List>
        <li>Paste only links to public posts that you can view yourself.</li>
        <li>Don&rsquo;t use scripts or bots, overload the service, or try to get around its limits or security.</li>
        <li>Don&rsquo;t use BookTrap for anything unlawful, or to collect information about people.</li>
      </List>
      <P>We may limit or block an account or network that breaks these rules.</P>

      <H2>Other people&rsquo;s posts</H2>
      <P>
        Posts belong to their creators and platforms. BookTrap links back to them and never republishes their photos or videos.
        BookTrap isn&rsquo;t affiliated with TikTok, Instagram, Meta, ByteDance, Goodreads or Fable, and their names are used only to
        describe what BookTrap works with. To ask for something to be removed, email <Mail subject="BookTrap removal request" />.
      </P>

      <H2>Accuracy</H2>
      <P>
        Books are identified automatically from images, captions and speech. Titles, authors, covers and ISBNs can be wrong or missing.
        You can edit any book. Please check before relying on it, for example before buying.
      </P>

      <H2>Your shelf and account</H2>
      <P>
        Your shelf is yours: export it whenever you like. As a guest, your shelf lives in this browser only: if its data is cleared
        before you save your shelf, or you don&rsquo;t visit for 30 days, the shelf is gone and we can&rsquo;t recover it. Once you
        save it with an email, you can open it anywhere by logging in. Keep your email account and password safe, since anyone who
        can sign in as you can see and change your shelf.
      </P>

      <H2>No guarantees</H2>
      <P>
        BookTrap is provided as it is, without warranties. It may be unavailable at times, and we may change or end it. If we end it,
        we&rsquo;ll give notice in the app so you can export your shelf. To the extent the law allows, {OPERATOR} isn&rsquo;t liable
        for indirect losses or for lost shelves. Nothing here limits rights you have by law.
      </P>

      <H2>Law</H2>
      <P>These terms are governed by the laws of the Kingdom of Bahrain.</P>

      <H2>Changes</H2>
      <P>We may update these terms. The date at the top shows the latest version.</P>
    </LegalPage>
  );
}
