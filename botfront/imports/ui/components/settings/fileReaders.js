import { useReducer } from 'react';
import {
    base,
    update,
    findFileInFileList,
    updateAtIndex,
    deleteAtIndex,
    determineDataType,
} from '../../../lib/importers/common';
import {
    fileToStoryGroup,
    validateStories,
    addStoryFile,
} from '../../../lib/importers/loadStories';
import { loadDomain } from '../../../lib/importers/loadDomain';
import { addNluFile, getLanguage } from '../../../lib/importers/loadNlu';

const validateFiles = files => validateStories(files);

const addFileAccordingToHeuristic = (f, rawText, params) => {
    const dataType = determineDataType(f, rawText);
    if (dataType === 'domain') {
        return update(params.setFileList, f, loadDomain({ rawText, ...params }));
    }
    if (dataType === 'stories') {
        return addStoryFile({ f, rawText, ...params });
    }
    if (dataType === 'nlu') {
        return addNluFile({ f, rawText, ...params });
    }
    return update(params.setFileList, f, { errors: ['unknown file format'] });
};

export const useFileReader = (params) => {
    const reducer = (fileList, instruction) => {
        // eslint-disable-next-line no-use-before-define
        const setFileList = ins => fileReader[1](ins);
        const {
            delete: deleteInstruction,
            add: addInstruction,
            update: updateInstruction,
            changeLang: changeLangInstruction,
        } = instruction;

        if (deleteInstruction) {
            const index = findFileInFileList(fileList, deleteInstruction);
            if (index < 0) return fileList;
            return validateFiles(deleteAtIndex(fileList, index));
        }
        if (addInstruction) {
            // add: array of files
            if (addInstruction.some(f => f.dataType === 'stories' && f.firstLine)) {
                // file already there, but data wiping toggled, so just need to change storygroup name
                return fileList.map((f) => {
                    if (f.dataType !== 'stories' || !f.firstLine) return f;
                    const { name } = fileToStoryGroup(f.filename, f.firstLine, [
                        ...(params.existingStoryGroups || []),
                    ]);
                    return { ...f, name };
                });
            }
            addInstruction.forEach((f) => {
                const reader = new FileReader();
                reader.readAsText(f);
                reader.onload = () => {
                    if (/\ufffd/.test(reader.result)) {
                        // out of range char test
                        return update(setFileList, f, {
                            errors: ['file is not parseable text'],
                        });
                    }
                    return addFileAccordingToHeuristic(f, reader.result, {
                        ...params,
                        fileList,
                        setFileList,
                    });
                };
            });
            return [...fileList, ...addInstruction.map(f => base(f))];
        }
        if (updateInstruction) {
            // callback for 'add' method
            const index = findFileInFileList(fileList, updateInstruction);
            if (index < 0) return fileList;
            if (
                fileList.some(
                    (f, idx) => f.name === updateInstruction.name && index !== idx,
                )
            ) {
                updateInstruction.errors = [
                    ...(updateInstruction.errors || []),
                    'Another file was uploaded with same name.',
                ];
            }
            return validateFiles(updateAtIndex(fileList, index, updateInstruction));
        }
        if (changeLangInstruction) {
            return fileList.map((f) => {
                if (f.dataType === 'domain') {
                    return {
                        ...f,
                        ...loadDomain({
                            ...f,
                            ...params,
                            fallbackImportLanguage: changeLangInstruction,
                        }),
                    };
                }
                if (f.dataType === 'nlu') {
                    return {
                        ...f,
                        language: getLanguage(f.rawText, changeLangInstruction),
                    };
                }
                return f;
            });
        }
        return fileList;
    };
    const fileReader = useReducer(reducer, []);
    return fileReader;
};
