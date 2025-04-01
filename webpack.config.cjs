const path = require('path');

module.exports = {
    entry: './src/analytic/webapp/index.ts',
    module: {
        rules: [
            {
                test: /\.ts?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    externals: {
        // To avoid bundling Plotly (it will be loaded from CDN)
        'plotly.js': 'Plotly',
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
        // This is required, because data_model.ts is used both in server and web sides
        // and it, in turns, import `status.js` with specified extension, whereas
        // imports with specified extensions are not allowed in web side
        extensionAlias: {
            '.js': ['.ts', '.js'],
        },
    },
    output: {
        filename: 'analytic/webapp/index.js',
        path: path.resolve(__dirname, 'dist'),
    }
};