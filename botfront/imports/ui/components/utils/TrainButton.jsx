import React from 'react';
import PropTypes from 'prop-types';
import { Meteor } from 'meteor/meteor';
import { withTracker } from 'meteor/react-meteor-data';
import {
    Button,
    Popup,
    Icon,
    Checkbox,
    Dropdown,
    Confirm,
    Modal,
} from 'semantic-ui-react';
import { get } from 'lodash';
import Alert from 'react-s-alert';
import 'react-s-alert/dist/s-alert-default.css';
import { wrapMeteorCallback } from './Errors';
import { StoryGroups } from '../../../api/storyGroups/storyGroups.collection';
import { Projects } from '../../../api/project/project.collection';
import { ProjectContext } from '../../layouts/context';
import { can, Can } from '../../../lib/scopes';

class TrainButton extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            modalOpen: { production: false },
            webhooks: {},
        };
        this.commitMessage = React.createRef();
    }

    copyToClipboard = () => {
        const {
            project: { _id: projectId },
        } = this.context;
        const dummy = document.createElement('textarea');
        document.body.appendChild(dummy);
        dummy.value = `${window.location.origin.toString()}/chat/${projectId}/`;
        dummy.select();
        document.execCommand('copy');
        document.body.removeChild(dummy);
    };

    train = (target = 'development') => {
        const {
            project: { _id: projectId },
        } = this.context;
        Meteor.call('project.markTrainingStarted', projectId);
        Meteor.call('rasa.train', projectId, target, wrapMeteorCallback());
    };

    showModal = (env, visible) => {
        const modalOpen = this.state;
        this.setState({ modalOpen: { ...modalOpen, [env]: visible } });
    };

    commitAndPush = () => {
        const {
            project: { _id: projectId },
        } = this.context;
        Meteor.call(
            'commitAndPushToRemote',
            projectId,
            this.commitMessage?.current?.value,
            wrapMeteorCallback(null, 'Successfully pushed to Git remote.'),
        );
    };

    renderCommitModal = () => (
        <Modal
            open
            size='small'
            header='Commit and push'
            onClick={e => e.stopPropagation()}
            content={(
                <div
                    className='side-by-side middle ui form'
                    style={{ padding: '1em' }}
                >
                    <input
                        className='ui input'
                        placeholder='Commit message'
                        ref={this.commitMessage}
                        autoFocus // eslint-disable-line jsx-a11y/no-autofocus
                    />
                    <Button
                        type='submit'
                        onClick={() => {
                            this.showModal('commit-and-push', false);
                            this.commitAndPush();
                        }}
                        content='Push to remote'
                    />
                </div>
            )}
            onClose={() => this.showModal('commit-and-push', false)}
        />
    )

    renderDeployDropDown = () => {
        const {
            project: { deploymentEnvironments: environments = [], gitString },
            instance,
        } = this.context;
        const { status } = this.props;
        const trainingInProgress = status === 'training' || status === 'notReachable' || !instance;
        const { webhook } = this.state;
        const { modalOpen } = this.state;
        const deployOptions = !webhook?.url
            ? []
            : environments.map(env => ({
                key: env,
                value: env,
                text: `Deploy to ${env}`,
            }));
        if (gitString || deployOptions.length) {
            // explicitly define the dropdown so we don't get the highlighted selection
            return (
                <Dropdown
                    className='button icon'
                    data-cy='train-and-deploy'
                    floating
                    disabled={trainingInProgress}
                    trigger={<React.Fragment />}
                >
                    <Dropdown.Menu>
                        <Dropdown.Item
                            icon='git'
                            text='Commit and push'
                            onClick={() => this.showModal('commit-and-push', true)}
                        />
                        {modalOpen['commit-and-push'] && this.renderCommitModal()}
                        {deployOptions.map(opt => (
                            <React.Fragment key={opt.key}>
                                <Dropdown.Item
                                    value={opt.value}
                                    onClick={() => this.showModal(opt.value, true)}
                                >
                                    {opt.text}
                                </Dropdown.Item>
                                <Confirm
                                    open={modalOpen[opt.value]}
                                    // we need to stop the propagation, otherwise it reopen the dropdown
                                    onCancel={(e) => {
                                        this.showModal(opt.value, false);
                                        e.stopPropagation();
                                    }}
                                    onConfirm={(e) => {
                                        this.trainAndDeploy(opt.value);
                                        this.showModal(opt.value, false);
                                        e.stopPropagation();
                                    }}
                                    content={`Do you really want to deploy your project to ${opt.value}`}
                                />
                            </React.Fragment>
                        ))}
                    </Dropdown.Menu>
                </Dropdown>
            );
        }
        return <></>;
    };

    deploy = (target) => {
        const {
            project: { _id: projectId },
        } = this.context;
        const { webhook } = this.state;

        try {
            if (!webhook.url || !webhook.method) {
                throw new Error('Deployment failed: the webhook parameters are missing');
            }
            if (!target) {
                throw new Error('Deployment failed: the deployment target is missing');
            }
            Meteor.call('deploy.model', projectId, target, (err, response) => {
                if (err || response === undefined || response.status !== 200) {
                    Alert.error(`Deployment failed: ${err.message}`, {
                        position: 'top-right',
                        timeout: 10000,
                    });
                }
                if (response.status === 200) {
                    Alert.success(
                        `Your project has been deployed to the ${target} environment`,
                        {
                            position: 'top-right',
                            timeout: 5000,
                        },
                    );
                }
            });
        } catch (e) {
            Alert.error(e.message, {
                position: 'top-right',
                timeout: 10000,
            });
        }
    };

    trainAndDeploy = async (target) => {
        try {
            const loadModel = target === 'development'; // automaticly load the model only if we are in development
            await this.train(target, loadModel);
            Alert.info(`Deployment to ${target} has started`, {
                position: 'top-right',
                timeout: 5000,
            });
            this.deploy(target);
        } catch (e) {
            Alert.error('Cannot deploy, training failed', {
                position: 'top-right',
                timeout: 3000,
            });
        }
    };

    renderButton = () => {
        const { instance } = this.context;
        const { popupContent, status, partialTrainning } = this.props;
        return (
            <Popup
                content={popupContent}
                trigger={(
                    <Button.Group color={partialTrainning ? 'yellow' : 'blue'}>
                        <Button
                            icon={partialTrainning ? 'eye' : 'grid layout'}
                            content={
                                partialTrainning ? 'Partial training' : 'Train everything'
                            }
                            labelPosition='left'
                            disabled={
                                status === 'training'
                                || status === 'notReachable'
                                || !instance
                            }
                            loading={status === 'training'}
                            onClick={() => {
                                this.train();
                            }}
                            data-cy='train-button'
                        />
                        {this.renderDeployDropDown()}
                    </Button.Group>
                )}
                // Popup is disabled while training
                disabled={status === 'training' || popupContent === ''}
                inverted
                size='tiny'
            />
        );
    };

    renderShareLink = () => {
        const {
            project: { enableSharing, _id: projectId },
        } = this.context;
        return (
            <Popup
                trigger={(
                    <Icon
                        name='mail forward'
                        data-cy='share-bot'
                        color='grey'
                        size='large'
                        link
                    />
                )}
                basic
                hoverable
                content={(
                    <div>
                        <Checkbox
                            toggle
                            disabled={!can('share:x', projectId)}
                            checked={enableSharing}
                            data-cy='toggle-bot-sharing'
                            onChange={() => Meteor.call(
                                'project.setEnableSharing',
                                projectId,
                                !enableSharing,
                            )
                            }
                            label={enableSharing ? 'Sharing enabled' : 'Sharing disabled'}
                        />
                        {enableSharing && (
                            <p>
                                <br />
                                <button
                                    type='button'
                                    className='link-like'
                                    data-cy='copy-sharing-link'
                                    onClick={this.copyToClipboard}
                                >
                                    <Icon name='linkify' /> Copy link
                                </button>
                            </p>
                        )}
                    </div>
                )}
            />
        );
    };

    static contextType = ProjectContext;

    render() {
        const { ready } = this.props;
        return (
            ready && (
                <div className='side-by-side middle'>
                    <Can I='nlu-data:x'>{this.renderButton()}</Can>
                    {this.renderShareLink()}
                </div>
            )
        );
    }
}

TrainButton.propTypes = {
    popupContent: PropTypes.string,
    status: PropTypes.string,
    partialTrainning: PropTypes.bool,
    ready: PropTypes.bool.isRequired,
};

TrainButton.defaultProps = {
    popupContent: '',
    status: '',
    partialTrainning: false,
};

export default withTracker((props) => {
    // Gets the required number of selected storygroups and sets the content and popup for the train button
    const { projectId } = props;
    const trainingStatusHandler = Meteor.subscribe('training.status', projectId);
    const storyGroupHandler = Meteor.subscribe('storiesGroup', projectId);
    const ready = storyGroupHandler.ready() && trainingStatusHandler.ready();

    let storyGroups;
    let selectedStoryGroups;
    let popupContent = '';
    let status;
    let partialTrainning = false;
    if (ready) {
        status = Projects.findOne(
            { _id: projectId },
            { field: { 'training.instanceStatus': 1 } },
        );
        status = get(status, 'training.instanceStatus', 'notReachable'); // if it is undefined we consider it not reachable
        storyGroups = StoryGroups.find({ projectId }, { field: { _id: 1 } }).fetch();
        selectedStoryGroups = storyGroups.filter(storyGroup => storyGroup.selected);
        partialTrainning = selectedStoryGroups.length > 0;
        if (partialTrainning && selectedStoryGroups.length > 1) {
            popupContent = `Train NLU and stories from ${selectedStoryGroups.length} focused story groups.`;
        } else if (selectedStoryGroups && selectedStoryGroups.length === 1) {
            popupContent = 'Train NLU and stories from 1 focused story group.';
        } else if (status === 'notReachable') {
            popupContent = 'Rasa instance not reachable';
        }
    }

    return {
        ready,
        popupContent,
        status,
        partialTrainning,
    };
})(TrainButton);
