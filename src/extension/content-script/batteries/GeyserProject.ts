import { Battery } from "~/types";

import getOriginData from "../originData";

const urlMatcher = /^https:\/\/geyser.fund\/([^/]+)(\/([^/]+))?$/;

const battery = (): Battery | void => {
  const urlParts = document.location.pathname.split("/");
  const project = urlParts[1];
  const name = urlParts[2];

  if (project && name) {
    handleProjectPage(name);
  }
};

function handleProjectPage(name: string) {
  const address =
    document.querySelector<HTMLElement>("#lightning-address")?.innerText;
  const title =
    document.querySelector<HTMLElement>("#project-title")?.innerText;
  const icon = document.querySelector<HTMLImageElement>("#project-avatar img")
    ?.src;

  if (address) {
    return {
      method: "lnurl",
      address: address,
      ...getOriginData(),
      description: "geyser.fund",
      name: title ?? name,
      icon: icon ?? "https://geyser.fund/logo-brand.svg",
    };
  }
}

const GeyserProject = {
  urlMatcher,
  battery,
};

export default GeyserProject;
