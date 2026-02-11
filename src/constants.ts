import { AdvancedURISettings } from "./types";

export const DEFAULT_SETTINGS: AdvancedURISettings = {
    openFileOnWrite: true,
    openDailyInNewPane: false,
    openFileOnWriteInNewPane: false,
    openFileWithoutWriteInNewPane: false,
    idField: "id",
    useId: true,
    addFileNameWhenUsingId: true,
    includeVaultName: false,
    vaultParam: "name",
    linkFormats: [
        {
            name: "Markdown",
            format: "[{{name}}]({{uri}})",
        },
    ],
};
