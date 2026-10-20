import { createFileRoute } from "@tanstack/react-router";
import { List, PolicyPage, Section } from "@/components/shop/PolicyPage";
import { seoMeta } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const Route = createFileRoute("/privacy-policy")({
  head: () =>
    seoMeta({
      title: "Privacy policy — MOA Mart",
      description: "What personal data MOA Mart collects, why, who we share it with, where it is stored, and how you can access, correct or delete it.",
      path: "/privacy-policy",
    }),
  component: Privacy,
});

function Privacy() {
  const mail = (
    <a href={`mailto:${SITE.email}`} className="text-primary hover:underline">
      {SITE.email}
    </a>
  );
  return (
    <PolicyPage
      title="Privacy policy"
      intro="This page explains what personal data we collect when you use MOA Mart, why we need it, and the choices you have."
    >
      <Section title="Who we are">
        <p>
          MOA Mart is operated by {SITE.legalName}, {SITE.address.street}, {SITE.address.city}, {SITE.address.country}. {SITE.legalName} decides how
          and why your personal data is used, and is responsible for it. You can reach us at {mail} or {SITE.phoneDisplay}.
        </p>
      </Section>

      <Section title="What we collect">
        <List
          items={[
            <>
              <strong className="font-medium text-foreground">Your account:</strong> first and last name, email address, and your password (kept in a
              protected form by our login service). If you sign in with Google, we receive your name and email from Google. You can also save a phone
              number and a default delivery location.
            </>,
            <>
              <strong className="font-medium text-foreground">Your orders:</strong> the items, amounts, the name, phone number and location you give for
              delivery, the status of the order, and any cancellation or refund.
            </>,
            <>
              <strong className="font-medium text-foreground">Your payments:</strong> the mobile money provider and number you pay with, and the status
              and reference numbers of the payment. Your mobile money PIN is entered on your phone. We never see it.
            </>,
            <>
              <strong className="font-medium text-foreground">Your messages:</strong> what you write to us in the chat, and the notifications we send you
              about your orders.
            </>,
            <>
              <strong className="font-medium text-foreground">If you shop as a guest:</strong> we create a temporary guest session so you can place and
              follow orders on that device.
            </>,
            <>
              <strong className="font-medium text-foreground">Technical data:</strong> your IP address and device details appear in the server logs of our
              hosting provider when you visit the site.
            </>,
          ]}
        />
      </Section>

      <Section title="Why we use it">
        <List
          items={[
            "to take your order, collect payment, deliver it and send refunds;",
            "to answer your messages and help you with an order;",
            "to tell you about your order and payment through notifications;",
            "to keep the shop secure and prevent fraud and misuse;",
            "to keep the records we are required to keep, for example for accounting.",
          ]}
        />
      </Section>

      <Section title="Who we share it with">
        <p>We share personal data only with the services we need to run the shop, and only what they need:</p>
        <List
          items={[
            <>
              <strong className="font-medium text-foreground">Supabase</strong>: our database, login and file storage. Your data is stored in Ireland (EU).
            </>,
            <>
              <strong className="font-medium text-foreground">PawaPay</strong>, with <strong className="font-medium text-foreground">MTN</strong> and{" "}
              <strong className="font-medium text-foreground">Airtel</strong>: to request and receive your mobile money payment and to send refunds.
            </>,
            <>
              <strong className="font-medium text-foreground">Vercel</strong>: hosts the website.
            </>,
            <>
              <strong className="font-medium text-foreground">Google</strong>: sign-in, if you choose to sign in with Google, and the fonts used on our
              pages. <strong className="font-medium text-foreground">jsDelivr</strong> serves our icon font. They can see your IP address when your
              browser loads these files.
            </>,
            "the people who deliver your order, who receive your name, phone number and delivery location;",
            "authorities, when the law requires it.",
          ]}
        />
        <p>We do not sell your personal data.</p>
      </Section>

      <Section title="Where your data is stored">
        <p>
          Our database is in Ireland (EU). Some of our other providers may process data in other countries, including outside Rwanda. We only use
          providers that we need to run the shop.
        </p>
      </Section>

      <Section title="How long we keep it">
        <List
          items={[
            "Orders and payment records: as long as we need them for accounting and legal duties.",
            "Your account: until you ask us to delete it.",
            "Notifications: read ones are removed automatically after 30 days, and all of them after 90 days.",
            "Chat messages: kept so we can help you again, until you ask us to delete them.",
          ]}
        />
      </Section>

      <Section title="Your rights">
        <p>Under Rwandan data protection law you can ask us to:</p>
        <List
          items={[
            "show you the personal data we hold about you and give you a copy;",
            "correct anything that is wrong or out of date;",
            "delete your data, or limit how we use it;",
            "stop using it for a purpose you object to.",
          ]}
        />
        <p>
          Write to {mail}. We may need to confirm that the request really comes from you. Some records, such as paid orders, we must keep for legal
          reasons, and we will tell you if that applies.
        </p>
      </Section>

      <Section title="Security">
        <p>
          The site uses an encrypted connection (HTTPS). Only people on our team who need access can see orders and messages. Payments are handled by
          your mobile money provider. No system is completely safe, so if something affects your data we will tell you and the authorities as the law
          requires.
        </p>
      </Section>

      <Section title="Browser storage and cookies">
        <p>
          We use your browser&apos;s storage to keep your cart, your saved items, your sign-in and the state of the chat. We do not use advertising
          cookies. If we ever add analytics, we will update this page first.
        </p>
      </Section>

      <Section title="Children">
        <p>MOA Mart is for adults. Please ask a parent or guardian to order for you if you are under 18.</p>
      </Section>

      <Section title="Complaints">
        <p>
          Please contact us first, so we can put things right. You can also complain to Rwanda&apos;s data protection authority, the National Cyber
          Security Authority (NCSA).
        </p>
      </Section>

      <Section title="Changes to this page">
        <p>When we change this policy we update the date at the top. For questions, write to {mail}.</p>
      </Section>
    </PolicyPage>
  );
}
