import { http, createConfig } from "wagmi";
import { mainnet } from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { ETH_RPCS } from "./constants";

export const wagmiConfig = getDefaultConfig({
  appName: "Octra → ETH Bridge (Free)",
  projectId: "octra_bridge_free_public",
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(ETH_RPCS[0]),
  },
  ssr: false,
}) as ReturnType<typeof createConfig>;
