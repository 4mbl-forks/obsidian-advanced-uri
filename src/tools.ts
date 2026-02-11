import {
    CachedMetadata,
    Notice,
    parseFrontMatterAliases,
    parseFrontMatterEntry,
    TFile,
} from "obsidian";
import { v4 as uuidv4 } from "uuid";
import AdvancedURI from "./main";
import { LinkFormat, Parameters } from "./types";
import { copyText } from "./utils";
import { GeneralModal } from "./modals/general_modal";
/**
 * These methods depend on the plugins settings in contrast to the utils.ts file, which's functions are independent of the plugins settings.
 */
export default class Tools {
    constructor(private readonly plugin: AdvancedURI) {}

    app = this.plugin.app;

    get settings() {
        return this.plugin.settings;
    }

    async writeIdToFile(file: TFile, id: string): Promise<string> {
        const frontmatter =
            this.app.metadataCache.getFileCache(file)?.frontmatter;
        const fileContent: string = await this.app.vault.read(file);
        const isYamlEmpty: boolean =
            (!frontmatter || frontmatter.length === 0) &&
            !fileContent.match(/^-{3}\s*\n*\r*-{3}/);
        let splitContent = fileContent.split("\n");
        const key = `${this.plugin.settings.idField}:`;
        if (isYamlEmpty) {
            splitContent.unshift("---");
            splitContent.unshift(`${key} ${id}`);
            splitContent.unshift("---");
        } else {
            const lineIndexOfKey = splitContent.findIndex((line) =>
                line.startsWith(key)
            );
            if (lineIndexOfKey != -1) {
                splitContent[lineIndexOfKey] = `${key} ${id}`;
            } else {
                splitContent.splice(1, 0, `${key} ${id}`);
            }
        }

        const newFileContent = splitContent.join("\n");
        await this.app.vault.modify(file, newFileContent);
        return id;
    }

    async getIdFromFile(file: TFile): Promise<string | undefined> {
        //await parsing of frontmatter
        const cache =
            this.app.metadataCache.getFileCache(file) ??
            (await new Promise<CachedMetadata>((resolve) => {
                const ref = this.app.metadataCache.on("changed", (metaFile) => {
                    if (metaFile.path == file.path) {
                        const cache = this.app.metadataCache.getFileCache(file);
                        this.app.metadataCache.offref(ref);
                        resolve(cache);
                    }
                });
            }));

        const id = parseFrontMatterEntry(
            cache.frontmatter,
            this.plugin.settings.idField
        );
        if (id != undefined) {
            if (id instanceof Array) {
                return id[0];
            } else {
                return id;
            }
        }
    }

    async generateURI(
        parameters: Parameters,
        options?: {
            excludeParams?: {
                heading?: boolean;
            };
            cleanId?: boolean;
            nameMaxLength?: number;
        }
    ) {
        const prefix = "obsidian://file";
        let suffix = "";
        const file = this.app.vault.getAbstractFileByPath(parameters.filepath);
        if (this.settings.includeVaultName) {
            suffix += "?vault=";
            if (this.settings.vaultParam == "id" && this.app.appId) {
                suffix += encodeURIComponent(this.app.appId);
            } else {
                suffix += encodeURIComponent(this.app.vault.getName());
            }
        }
        if (
            this.settings.useId &&
            file instanceof TFile &&
            file.extension == "md"
        ) {
            if (!this.settings.addFileNameWhenUsingId)
                parameters.filepath = undefined;
            const uuid =
                (await this.getIdFromFile(file)) ??
                (await this.writeIdToFile(file, uuidv4()));
            parameters.id = options?.cleanId ? uuid.replaceAll("-", "") : uuid;
        }

        const filterParameters = <K extends keyof Parameters>(
            parameters: Parameters,
            exclude?: Partial<Record<K, boolean>>
        ): Omit<Parameters, K> => {
            const result = { ...parameters };

            if (exclude) {
                (Object.keys(exclude) as K[]).forEach((key) => {
                    if (exclude[key]) {
                        delete result[key];
                    }
                });
            }

            return result;
        };

        const sortedParameterKeys = (
            Object.keys(
                filterParameters(parameters, options?.excludeParams)
            ) as (keyof Parameters)[]
        )
            .filter((key) => parameters[key])
            .sort((a, b) => {
                const first = ["name", "filename", "id", "daily"];
                const last = ["data", "eval"];
                if (first.includes(a)) return -1;
                if (first.includes(b)) return 1;
                if (last.includes(a)) return 1;
                if (last.includes(b)) return -1;
                return 0;
            });

        for (const parameter of sortedParameterKeys) {
            if (parameters[parameter] === undefined) continue;

            suffix += suffix ? "&" : "?";
            if (parameter === "filepath") {
            }
            const key = parameter === "filepath" ? "name" : parameter;
            const value =
                parameter === "filepath"
                    ? encodeURIComponent(
                          parameters[parameter]
                              .replace(
                                  "." +
                                      (file && file instanceof TFile
                                          ? file.extension
                                          : "md"),
                                  ""
                              )
                              .split("/")
                              .pop()
                              ?.replaceAll(" ", "-")
                              .slice(0, options?.nameMaxLength)
                      )
                    : encodeURIComponent(parameters[parameter]);
            suffix += `${key}=${value}`;
        }
        // When the URI gets decoded, the %20 at the end gets somehow removed.
        // Adding a trailing & to prevent this.
        if (suffix.endsWith("%20")) suffix += "&";
        return prefix + suffix;
    }

    async copyURI(
        parameters: Parameters,
        withFormat = false,
        file: TFile = undefined,
        options?: {
            excludeParams?: {
                heading?: boolean;
            };
        }
    ) {
        const uri = await this.generateURI(parameters, {
            ...options,
            cleanId: true,
            nameMaxLength: 100,
        });
        if (withFormat) {
            const linkFormats = this.settings.linkFormats;
            if (linkFormats.length == 0) {
                new Notice("No link formats defined in the settings");
                return;
            }
            let linkFormat: LinkFormat;
            if (linkFormats.length == 1) {
                linkFormat = linkFormats[0];
            } else {
                const linkFormatNames = linkFormats.map(
                    (format) => format.name
                );
                const selected = await new GeneralModal(this.plugin, {
                    options: linkFormatNames,
                    onlySelection: true,
                    placeholder: "Select link format",
                }).openAndGetResult();
                if (!selected) {
                    new Notice("No link format selected");
                    return;
                }
                linkFormat = linkFormats.find((f) => f.name == selected)!;
            }

            let formattedLink = linkFormat.format
                .replace(/\{\{uri\}\}/g, uri)
                .replace(/\{\{path\}\}/g, file?.path)
                .replace(/\{\{folder\}\}/g, file?.parent?.path)
                .replace(/\{\{name\}\}/g, file?.basename)
                .replace(/\{\{vaultName\}\}/g, this.app.vault.getName())
                .replace(/\{\{vaultId\}\}/g, this.app.appId);
            if (file && formattedLink.match(/\{\{id\}\}/g)) {
                const id = (await this.getIdFromFile(file)) ?? file.basename;
                formattedLink = formattedLink.replace(/\{\{id\}\}/g, id);
            }
            if (file && formattedLink.match(/\{\{alias\}\}/g)) {
                const aliases = parseFrontMatterAliases(
                    this.app.metadataCache.getFileCache(file).frontmatter
                );
                const alias = aliases ? aliases[0] : file?.basename;
                formattedLink = formattedLink.replace(/\{\{alias\}\}/g, alias);
            }
            await copyText(formattedLink);
            new Notice(
                `URI in format "${linkFormat.name}" copied to your clipboard`
            );
            return;
        }
        await copyText(uri);

        new Notice("URI copied to your clipboard");
    }

    getFileFromId(id: string): TFile | undefined {
        const files = this.app.vault.getMarkdownFiles();
        const idKey = this.settings.idField;
        for (const file of files) {
            const fieldValue = parseFrontMatterEntry(
                this.app.metadataCache.getFileCache(file)?.frontmatter,
                idKey
            );

            if (fieldValue instanceof Array) {
                if (fieldValue.contains(id)) return file;
            } else {
                if (fieldValue == id) return file;
            }
        }
    }

    getFileFromBlockID(blockId: string): TFile | undefined {
        const files = this.app.vault.getMarkdownFiles();

        blockId = blockId.toLowerCase();
        for (const file of files) {
            const blockExists =
                this.app.metadataCache.getFileCache(file)?.blocks?.[blockId] !=
                undefined;
            if (blockExists) return file;
        }
    }
}
