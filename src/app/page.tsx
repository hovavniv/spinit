import { DiscoBall } from '@/components/brand/DiscoBall';
import { SiteNav } from '@/components/home/SiteNav';
import { Hero } from '@/components/home/Hero';
import { HowItWorks } from '@/components/home/HowItWorks';
import { RecapSection } from '@/components/home/RecapSection';
import { FinalCta } from '@/components/home/FinalCta';
import { SiteFooter } from '@/components/home/SiteFooter';

export default function Home() {
  return (
    <>
      <DiscoBall />
      <SiteNav />
      <main>
        <Hero />
        <HowItWorks />
        <RecapSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
