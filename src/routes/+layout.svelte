<script lang="ts">
	import '../app.css';
	import '@phosphor-icons/web/regular';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>万能搜索</title>
</svelte:head>

{@render children()}
