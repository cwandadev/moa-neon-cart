import { createFileRoute, Link } from "@tanstack/react-router";
import { Business, PolicyPage, Section } from "@/components/shop/PolicyPage";
import { seoMeta } from "@/lib/seo";
import { SITE } from "@/lib/site";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/contact")({
  head: () =>
    seoMeta({
      title: "Contact us — MOA Mart",
      description: `Contact MOA Mart in ${SITE.address.city}: chat, email ${SITE.email} or call ${SITE.phoneDisplay}. KG 551, ${SITE.address.city}, ${SITE.address.country}.`,
      path: "/contact",
    }),
  component: Contact,
});

const row = "flex items-start gap-3 rounded-xl py-3 transition-colors";

function Contact() {
  const { setChatOpen } = useStore();
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${SITE.address.street} ${SITE.address.city} ${SITE.address.country}`)}`;
  return (
    <PolicyPage title="Contact us" intro="We are happy to help with an order, a product or delivery.">
      <Section title="Ways to reach us">
        <ul className="grid divide-y divide-border">
          <li>
            <button type="button" onClick={() => setChatOpen(true)} className={`${row} w-full text-left hover:text-foreground`}>
              <i className="bx bx-message-dots mt-0.5 text-2xl text-primary" />
              <span>
                <span className="block font-medium text-foreground">Chat with us</span>
                <span className="block text-sm">The quickest way to ask about an order. Open the chat and write to us.</span>
              </span>
            </button>
          </li>
          <li>
            <a href={`mailto:${SITE.email}`} className={`${row} hover:text-foreground`}>
              <i className="bx bx-envelope mt-0.5 text-2xl text-primary" />
              <span>
                <span className="block font-medium text-foreground">Email</span>
                <span className="block text-sm">{SITE.email}</span>
              </span>
            </a>
          </li>
          <li>
            <a href={`tel:${SITE.phone}`} className={`${row} hover:text-foreground`}>
              <i className="bx bx-phone mt-0.5 text-2xl text-primary" />
              <span>
                <span className="block font-medium text-foreground">Phone</span>
                <span className="block text-sm">{SITE.phoneDisplay}</span>
              </span>
            </a>
          </li>
          <li>
            <a href={maps} target="_blank" rel="noreferrer" className={`${row} hover:text-foreground`}>
              <i className="bx bx-map mt-0.5 text-2xl text-primary" />
              <span>
                <span className="block font-medium text-foreground">Address</span>
                <span className="block text-sm">
                  {SITE.address.street}, {SITE.address.city}, {SITE.address.country}
                </span>
              </span>
            </a>
          </li>
        </ul>
      </Section>

      <Section title="Before you write">
        <p>
          If your question is about an order, have the order number ready (for example MOA-4810). You can find it in{" "}
          <Link to="/orders" className="text-primary hover:underline">
            My orders
          </Link>
          . We reply as soon as we can.
        </p>
        <p>
          More information: <Link to="/delivery" className="text-primary hover:underline">Delivery</Link> and{" "}
          <Link to="/returns" className="text-primary hover:underline">Returns and refunds</Link>.
        </p>
      </Section>

      <Section title="Who we are">
        <p>
          <Business />
        </p>
      </Section>
    </PolicyPage>
  );
}
