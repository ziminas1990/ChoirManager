import path from 'path';
import webpack from 'webpack';

const config: webpack.Configuration = {
  mode: 'production',
  devtool: false,
  entry: './src/analytic/webpack/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'inex.js',
  },
};

export default config;