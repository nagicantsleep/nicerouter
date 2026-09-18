import PlaygroundClient from "./PlaygroundClient";

export const metadata = {
  title: "Playground | 9Router",
  description: "Test and benchmark LLM models, combos, and reasoning endpoints",
};

export default function PlaygroundPage() {
  return <PlaygroundClient />;
}
