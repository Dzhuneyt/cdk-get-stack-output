import * as AWS from 'aws-sdk';
import * as yargs from 'yargs';
import {StackManager} from "./stack-manager";
import {Arguments} from "./arguments";
import * as chalk from "chalk";
import {STS} from "aws-sdk";

process.env.AWS_SDK_LOAD_CONFIG = '1';

if (process.env.AWS_PROFILE) {
    AWS.config.credentials =
        new AWS.SharedIniFileCredentials({profile: process.env.AWS_PROFILE});
}

yargs.option({
    name: {
        type: 'string',
        describe: 'The output name to retrieve from the CDK stack',
        // Argument is required
        demandOption: true,
    },
    fromStack: {
        description: "The full or partial stack name, where to look for the output parameter. If empty, all available CDK stacks will be searched.",
        type: "string",
        // Argument is not required but recommended,
        // because if the output is found in multiple CloudFormation stacks,
        // an error is thrown
        demandOption: false,
    }
});
const args: Arguments = yargs.parse();

const filterByStackPartialName = args.fromStack;
const outputNameToSearch = args.name as string;

const stackManager = new StackManager();

const getIdentity = async (): Promise<AWS.STS.Types.GetCallerIdentityResponse> => {
    return await new STS().getCallerIdentity().promise();
};

stackManager.getStacks().then(async (allStacks: AWS.CloudFormation.Stack[]) => {
    let stacksWhereTheOutputWasFound: String[] = [];
    let finalValue = null;
    let stacksToIterate: AWS.CloudFormation.Stack[] = [];

    stacksToIterate = allStacks.filter((stack: AWS.CloudFormation.Stack) => {
        return !filterByStackPartialName || stack.StackName.includes(args.fromStack!);
    });

    if (!stacksToIterate.length) {
        const identity = await getIdentity();
        console.log(chalk.red(
            `No CloudFormation stacks match the filter.
            Please check if you have provided the correct account, region and credentials.`
        ));
        console.log(
            identity.Account,
            AWS.config.region
        );
        process.exit(1);
    }

    stacksToIterate.forEach((iteratedStack: AWS.CloudFormation.Stack) => {
        iteratedStack.Outputs!.forEach((output: AWS.CloudFormation.Output) => {
            if (output.ExportName === args.name || output.OutputKey === args.name) {
                if (!stacksWhereTheOutputWasFound.includes(iteratedStack.StackName)) {
                    stacksWhereTheOutputWasFound.push(iteratedStack.StackName);
                }
                finalValue = output.OutputValue;
            }
        });
    });

    if (finalValue === null) {
        // Attempt a partial search as well
        stacksToIterate.forEach((iteratedStack: AWS.CloudFormation.Stack) => {
            iteratedStack.Outputs!.forEach((output: AWS.CloudFormation.Output) => {
                if (output.OutputKey?.includes(outputNameToSearch) || output.ExportName?.includes(outputNameToSearch)) {
                    finalValue = output.OutputValue;
                }
            });
        });
    }

    if (stacksWhereTheOutputWasFound.length > 1) {
        const stackNamesConcat = stacksWhereTheOutputWasFound.join(', ');
        console.log(chalk.red(
            `The output has been found in multiple stacks: ${stackNamesConcat}. Please reduce the search by specifying the --stackName parameter.`
        ));
        process.exit(1);
    }

    if (finalValue === null) {
        console.log(chalk.red(
            `Output has not been found in the stack`
        ));
        process.exit(1);
    }
    console.log(finalValue);
});
