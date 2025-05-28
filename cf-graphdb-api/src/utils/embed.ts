// utils/embed.ts

import Together from 'together-ai';

const togetherClient = new Together({
	apiKey: process.env.TOGETHER_API_KEY || ''
});

export async function embedTextUsingTogetherAI(text: string, apiKeyOverride?: string): Promise<number[]> {
	if (apiKeyOverride) {
		togetherClient.apiKey = apiKeyOverride;
	}

	const response = await togetherClient.embeddings.create({
		model: 'togethercomputer/m2-bert-80M-32k-retrieval',
		input: text
	});

	const embedding = response.data?.[0]?.embedding;

	if (!Array.isArray(embedding)) {
		throw new Error("Invalid embedding response format");
	}

	return embedding;
}
