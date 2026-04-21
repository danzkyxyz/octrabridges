import { http, createConfig } from "wagmi";
import { mainnet } from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { ETH_RPCS } from "./constants";

export const wagmiConfig = getDefaultConfig({
  appName: "Octra → ETH Bridge (Free)",
  projectId: "0c3622a80434b6e91e02735d8ed7b961",
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(ETH_RPCS[0]),
  },
  ssr: false,
}) as ReturnType<typeof createConfig>;
