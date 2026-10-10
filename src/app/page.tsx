import { Finale, Hero, LoopScene, Nav, SmoothScroll, StarHandoff, Steps, Watched } from "@/components/landing";

export default function Home() {
  return (
    <div className="landing">
      <SmoothScroll />
      <Nav />
      <StarHandoff />
      <main>
        <Hero />
        <LoopScene />
        <Steps />
        <Watched />
        <Finale />
      </main>
    </div>
  );
}
