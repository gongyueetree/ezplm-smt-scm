import { runEzplmProviderContract } from "./helpers/ezplm-contract";
import { MockEzplmProvider } from "@/lib/providers/ezplm";

runEzplmProviderContract("MockEzplmProvider", () => new MockEzplmProvider());
